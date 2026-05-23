/**
 * Serviço responsável por realizar chamadas HTTP de Webhook para pedidos parados.
 */

export interface WebhookResult {
  success: boolean;
  status?: number;
  error?: string;
}

/**
 * Dispara uma notificação via HTTP POST contendo o idPedido para a API Webhook externa.
 */
export async function dispararWebhook(idPedido: string): Promise<WebhookResult> {
  const webhookUrl = process.env.WEBHOOK_URL || "https://api.ficticia-webhook.com/receber";

  console.info(
    JSON.stringify({
      message: "Iniciando disparo de Webhook para o pedido",
      context: {
        idPedido,
        url: webhookUrl,
      },
    })
  );

  try {
    // Timeout de 5 segundos utilizando AbortController nativo
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ idPedido }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Nenhum detalhe retornado.");
      console.error(
        JSON.stringify({
          message: "Falha na resposta do Webhook",
          context: {
            idPedido,
            status: response.status,
            statusText: response.statusText,
            errorBody: errorText,
          },
        })
      );
      return { success: false, status: response.status, error: response.statusText };
    }

    console.info(
      JSON.stringify({
        message: "Webhook disparado com sucesso",
        context: {
          idPedido,
          status: response.status,
        },
      })
    );

    return { success: true, status: response.status };
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;

    console.error(
      JSON.stringify({
        message: "Erro de rede/conexão ao disparar Webhook",
        context: {
          idPedido,
          url: webhookUrl,
          errorMessage: errMsg,
          stack: errStack,
        },
      })
    );

    return { success: false, error: errMsg };
  }
}
