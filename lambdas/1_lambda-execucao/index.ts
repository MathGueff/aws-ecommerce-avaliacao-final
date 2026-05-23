/* eslint-disable @typescript-eslint/no-explicit-any */
import { DynamoDBStreamEvent, DynamoDBRecord } from "aws-lambda";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { construirTemplateEmail, PedidoDados } from "./templateBuilder";
import { enviarEmail } from "./emailService";

/**
 * Mapeia e normaliza os campos do pedido, suportando tanto camelCase (usado no mockup local)
 * quanto PascalCase (especificado nas diretrizes do banco de dados).
 */
function extrairDadosPedido(item: Record<string, any>): PedidoDados {
  return {
    idPedido: item.idPedido ?? item.IdPedido ?? "",
    emailCliente: item.emailCliente ?? item.EmailCliente ?? "",
    nomeCliente: item.nomeCliente ?? item.NomeCliente ?? "",
    valor: item.valor ?? item.Valor ?? 0,
    data: item.data ?? item.Data ?? "",
    status: item.status ?? item.Status ?? "",
    referenciaNota: item.referenciaNota ?? item.ReferenciaNota ?? null,
    dataEnvio: item.dataEnvio ?? item.DataEnvio ?? null,
  };
}

/**
 * Handler principal da AWS Lambda triggered por DynamoDB Streams.
 */
export const handler = async (event: DynamoDBStreamEvent): Promise<void> => {
  const records: DynamoDBRecord[] = event.Records;

  console.info(
    JSON.stringify({
      message: `Iniciando processamento de lote do DynamoDB Stream`,
      totalRecords: records.length,
    }),
  );

  for (const record of records) {
    const eventName = record.eventName;
    const eventId = record.eventID;

    // Ignora eventos que não sejam de inserção ou modificação
    if (eventName !== "INSERT" && eventName !== "MODIFY") {
      console.info(
        JSON.stringify({
          message: "Ignorando evento não relacionado a inserção ou modificação",
          eventName,
          eventId,
        }),
      );
      continue;
    }

    try {
      const rawNewImage = record.dynamodb?.NewImage;
      const rawOldImage = record.dynamodb?.OldImage;

      if (!rawNewImage) {
        console.warn(
          JSON.stringify({
            message:
              "Imagem de dados novos (NewImage) ausente no record. Pulando.",
            eventId,
          }),
        );
        continue;
      }

      // Converte as imagens nativas do DynamoDB para objetos JS limpos
      const newImageUnmarshalled = unmarshall(
        rawNewImage as Record<string, any>,
      );
      const oldImageUnmarshalled = rawOldImage
        ? unmarshall(rawOldImage as Record<string, any>)
        : null;

      const novoPedido = extrairDadosPedido(newImageUnmarshalled);
      const pedidoAnterior = oldImageUnmarshalled
        ? extrairDadosPedido(oldImageUnmarshalled)
        : null;

      const statusNovo = novoPedido.status;
      const statusAnterior = pedidoAnterior ? pedidoAnterior.status : null;

      // Se for modificação, verifica se o status de fato mudou
      if (eventName === "MODIFY" && statusNovo === statusAnterior) {
        console.info(
          JSON.stringify({
            message:
              "Status do pedido não foi alterado. Nenhuma notificação necessária.",
            context: {
              idPedido: novoPedido.idPedido,
              statusNovo,
              statusAnterior,
              eventId,
            },
          }),
        );
        continue;
      }

      console.info(
        JSON.stringify({
          message: "Alteração de status de pedido detectada",
          context: {
            idPedido: novoPedido.idPedido,
            statusAnterior,
            statusNovo,
            evento: eventName,
            eventId,
          },
        }),
      );

      // Constrói o e-mail correspondente usando as regras de template
      const template = construirTemplateEmail(novoPedido);
      if (!template) {
        console.warn(
          JSON.stringify({
            message:
              "Status desconhecido ou não mapeado para envio de e-mail. Pulando.",
            context: {
              idPedido: novoPedido.idPedido,
              status: statusNovo,
              eventId,
            },
          }),
        );
        continue;
      }

      // Envia o e-mail de notificação para o cliente
      if (!novoPedido.emailCliente) {
        console.error(
          JSON.stringify({
            message:
              "E-mail do cliente não fornecido no pedido. Impossível enviar e-mail.",
            context: {
              idPedido: novoPedido.idPedido,
              eventId,
            },
          }),
        );
        continue;
      }

      const emailResult = await enviarEmail({
        to: novoPedido.emailCliente,
        subject: template.subject,
        body: template.body,
        idPedido: novoPedido.idPedido,
      });

      if (!emailResult.success) {
        console.error(
          JSON.stringify({
            message: "Falha no envio da notificação do pedido",
            context: {
              idPedido: novoPedido.idPedido,
              destinatario: novoPedido.emailCliente,
              status: statusNovo,
              erro: emailResult.error,
              eventId,
            },
          }),
        );
      } else {
        console.info(
          JSON.stringify({
            message: "Notificação de pedido concluída com sucesso",
            context: {
              idPedido: novoPedido.idPedido,
              destinatario: novoPedido.emailCliente,
              status: statusNovo,
              messageId: emailResult.messageId,
              eventId,
            },
          }),
        );
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;

      console.error(
        JSON.stringify({
          message: "Erro interno ao processar record do DynamoDB Stream",
          context: {
            eventId,
            errorMessage: errMsg,
            stack: errStack,
          },
        }),
      );
    }
  }

  console.info(
    JSON.stringify({
      message: "Processamento de lote concluído",
    }),
  );
};
