import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import * as nodemailer from "nodemailer";

let sesClient: SESClient | null = null;

/**
 * Retorna ou inicializa o cliente AWS SES.
 */
function getSESClient(): SESClient {
  if (!sesClient) {
    sesClient = new SESClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
  }
  return sesClient;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
  idPedido: string;
}

/**
 * Envia um e-mail estruturado utilizando AWS SES (produção) ou SMTP (desenvolvimento/fallback).
 */
export async function enviarEmail(
  params: SendEmailParams,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { to, subject, body, idPedido } = params;

  // Carrega configurações dinamicamente na execução da função
  const senderEmail = process.env.SENDER_EMAIL || "no-reply@ecommerce.com";
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT
    ? parseInt(process.env.SMTP_PORT, 10)
    : 587;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpSecure = process.env.SMTP_SECURE === "true";

  const useSES = !smtpHost;

  console.info(
    JSON.stringify({
      message: "Iniciando envio de e-mail de notificação",
      context: {
        idPedido,
        destinatario: to,
        remetente: senderEmail,
        provedor: useSES ? "AWS SES" : "SMTP",
      },
    }),
  );

  if (useSES) {
    try {
      const client = getSESClient();
      const command = new SendEmailCommand({
        Source: senderEmail,
        Destination: {
          ToAddresses: [to],
        },
        Message: {
          Subject: {
            Data: subject,
            Charset: "UTF-8",
          },
          Body: {
            Text: {
              Data: body,
              Charset: "UTF-8",
            },
          },
        },
      });

      const response = await client.send(command);

      console.info(
        JSON.stringify({
          message: "E-mail enviado com sucesso via AWS SES",
          context: {
            idPedido,
            destinatario: to,
            messageId: response.MessageId,
          },
        }),
      );

      return { success: true, messageId: response.MessageId };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;

      console.error(
        JSON.stringify({
          message: "Falha ao enviar e-mail via AWS SES",
          context: {
            idPedido,
            destinatario: to,
            errorMessage: errMsg,
            stack: errStack,
          },
        }),
      );

      if (smtpHost) {
        console.warn("Tentando fallback para SMTP após erro no SES");
      } else {
        return { success: false, error: errMsg };
      }
    }
  }

  // Envio via SMTP (desenvolvimento ou fallback)
  if (smtpHost) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth:
          smtpUser && smtpPass
            ? {
                user: smtpUser,
                pass: smtpPass,
              }
            : undefined,
        tls: {
          rejectUnauthorized: false,
        },
      });

      const mailOptions = {
        from: senderEmail,
        to,
        subject,
        text: body,
      };

      const info = await transporter.sendMail(mailOptions);

      console.info(
        JSON.stringify({
          message: "E-mail enviado com sucesso via SMTP",
          context: {
            idPedido,
            destinatario: to,
            messageId: info.messageId,
          },
        }),
      );

      return { success: true, messageId: info.messageId };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;

      console.error(
        JSON.stringify({
          message: "Falha ao enviar e-mail via SMTP",
          context: {
            idPedido,
            destinatario: to,
            errorMessage: errMsg,
            stack: errStack,
          },
        }),
      );
      return { success: false, error: errMsg };
    }
  }

  return {
    success: false,
    error:
      "Nenhum provedor de e-mail (SES ou SMTP) está configurado corretamente.",
  };
}
