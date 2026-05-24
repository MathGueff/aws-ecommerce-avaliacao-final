/**
 * Serviço de templates para e-mails de notificação de pedidos.
 */

export interface PedidoDados {
  idPedido: string;
  emailCliente: string;
  nomeCliente: string;
  valor: number | string;
  data: string;
  status: string;
  referenciaNota?: string | null;
  dataEnvio?: string | null;
}

export interface EmailTemplate {
  subject: string;
  body: string;
}

/**
 * Normaliza o status do pedido para tratar variações como "RECEBIDO" e "RECEBIMENTO" de forma tolerante.
 */
export function normalizarStatus(
  status: string,
): "RECEBIMENTO" | "PREPARACAO" | "ENVIADO" | null {
  if (!status) return null;
  const upperStatus = status.trim().toUpperCase();
  if (upperStatus === "RECEBIMENTO" || upperStatus === "RECEBIDO") {
    return "RECEBIMENTO";
  }
  if (upperStatus === "PREPARACAO") {
    return "PREPARACAO";
  }
  if (upperStatus === "ENVIADO") {
    return "ENVIADO";
  }
  return null;
}

/**
 * Formata um valor numérico para o padrão de moeda brasileiro (R$ X,XX).
 */
export function formatarMoeda(valor: number | string): string {
  const num = typeof valor === "number" ? valor : parseFloat(valor);
  if (isNaN(num)) return String(valor);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(num);
}

/**
 * Formata uma data no formato ISO para o padrão brasileiro (DD/MM/AAAA HH:mm:ss).
 */
export function formatarData(dataStr?: string | null): string {
  if (!dataStr) return "";
  try {
    const data = new Date(dataStr);
    if (isNaN(data.getTime())) return dataStr;

    // Formata a data para pt-BR
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "medium",
      timeZone: "America/Sao_Paulo",
    }).format(data);
  } catch {
    return dataStr;
  }
}

/**
 * Constrói o assunto e o corpo do e-mail com base no status do pedido e seus atributos.
 */
export function construirTemplateEmail(
  pedido: PedidoDados,
): EmailTemplate | null {
  const statusNormalizado = normalizarStatus(pedido.status);
  if (!statusNormalizado) {
    return null;
  }

  const nome = pedido.nomeCliente || "Cliente";
  const valorFormatado = formatarMoeda(pedido.valor);
  const dataFormatada = formatarData(pedido.data);

  let subject = "";
  let body = "";

  const defaultHeader = `Prezado(a) ${nome}, agradecemos pela sua compra!`
  switch (statusNormalizado) {
    case "RECEBIMENTO":
      subject = `Pedido ${pedido.idPedido} Recebido com Sucesso!`;
      body = `${defaultHeader}\n\nO seu pedido foi recebido e será enviado em breve!\n\nDados do pedido:\nValor total: ${valorFormatado}\nData da compra: ${dataFormatada}`;
      break;

    case "PREPARACAO":
      subject = `Seu Pedido ${pedido.idPedido} está em Preparação!`;
      body = `${defaultHeader}\n\nO seu pedido está na etapa de preparação e será enviado em breve!\n\nDados do pedido:\nValor total: ${valorFormatado}\nData da compra: ${dataFormatada}`;
      break;

    case "ENVIADO": {
      const dataEnvioFormatada = formatarData(pedido.dataEnvio);
      const notaFiscal = pedido.referenciaNota || "Nota Fiscal indisponível";
      subject = `Seu Pedido ${pedido.idPedido} foi Enviado!`;
      body = `${defaultHeader}\n\nPassando para avisar que o seu pedido já foi enviado e a data de recebimento é de 7 dias úteis.\n\nDados do pedido:\nValor total: ${valorFormatado}\nData da compra: ${dataFormatada}\n\nDados do envio:\nData do envio: ${dataEnvioFormatada}\nLink da nota fiscal: ${notaFiscal}`;
      break;
    }
  }

  return { subject, body };
}
