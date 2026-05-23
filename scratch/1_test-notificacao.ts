import * as nodemailer from "nodemailer";
import { handler } from "../lambdas/1_lambda-notificacao/index";
import { DynamoDBStreamEvent } from "aws-lambda";

async function runTests() {
  console.log("=== INICIANDO SIMULAÇÃO LOCAL DA LAMBDA-NOTIFICAÇÃO ===");

  try {
    // 1. Cria uma conta de teste SMTP temporária no Ethereal Email para visualização real do e-mail!
    console.log("Criando credenciais SMTP temporárias no Ethereal Email...");
    const testAccount = await nodemailer.createTestAccount();

    // Injeta as credenciais nas variáveis de ambiente para que o emailService as utilize
    process.env.SMTP_HOST = testAccount.smtp.host;
    process.env.SMTP_PORT = String(testAccount.smtp.port);
    process.env.SMTP_USER = testAccount.user;
    process.env.SMTP_PASS = testAccount.pass;
    process.env.SMTP_SECURE = String(testAccount.smtp.secure);
    process.env.SENDER_EMAIL = `financeiro@ficticio-ecommerce.com`;

    console.log(`Credenciais SMTP de Teste criadas!`);
    console.log(`Servidor: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT}`);
    console.log(`Usuário: ${process.env.SMTP_USER}\n`);
    console.log(`Senha: ${process.env.SMTP_PASS}\n`);

    // 2. Simula Cenário 1: Novo Pedido Recebido (INSERT com status RECEBIMENTO / RECEBIDO)
    console.log("--- CENÁRIO 1: Novo pedido inserido (Status: RECEBIDO) ---");
    const eventoInsert: DynamoDBStreamEvent = {
      Records: [
        {
          eventID: "event-id-001",
          eventName: "INSERT",
          dynamodb: {
            NewImage: {
              idPedido: { S: "ped-12345-abcde" },
              emailCliente: { S: "cliente.teste@ficticio.com" },
              nomeCliente: { S: "Guilherme Silva" },
              valor: { N: "249.90" },
              data: { S: new Date().toISOString() },
              status: { S: "RECEBIDO" },
            },
          },
        },
      ],
    };
    await handler(eventoInsert);
    console.log("Cenário 1 concluído.\n");

    // 3. Simula Cenário 2: Status alterado para PREPARACAO (MODIFY de RECEBIDO para PREPARACAO)
    console.log(
      "--- CENÁRIO 2: Mudança de status para PREPARACAO (MODIFY) ---",
    );
    const eventoPreparacao: DynamoDBStreamEvent = {
      Records: [
        {
          eventID: "event-id-002",
          eventName: "MODIFY",
          dynamodb: {
            OldImage: {
              idPedido: { S: "ped-12345-abcde" },
              emailCliente: { S: "cliente.teste@ficticio.com" },
              nomeCliente: { S: "Guilherme Silva" },
              valor: { N: "249.90" },
              data: { S: new Date().toISOString() },
              status: { S: "RECEBIDO" },
            },
            NewImage: {
              idPedido: { S: "ped-12345-abcde" },
              emailCliente: { S: "cliente.teste@ficticio.com" },
              nomeCliente: { S: "Guilherme Silva" },
              valor: { N: "249.90" },
              data: { S: new Date().toISOString() },
              status: { S: "PREPARACAO" },
            },
          },
        },
      ],
    };
    await handler(eventoPreparacao);
    console.log("Cenário 2 concluído.\n");

    // 4. Simula Cenário 3: Status alterado para ENVIADO (MODIFY de PREPARACAO para ENVIADO)
    console.log("--- CENÁRIO 3: Mudança de status para ENVIADO (MODIFY) ---");
    const eventoEnviado: DynamoDBStreamEvent = {
      Records: [
        {
          eventID: "event-id-003",
          eventName: "MODIFY",
          dynamodb: {
            OldImage: {
              idPedido: { S: "ped-12345-abcde" },
              emailCliente: { S: "cliente.teste@ficticio.com" },
              nomeCliente: { S: "Guilherme Silva" },
              valor: { N: "249.90" },
              data: { S: new Date().toISOString() },
              status: { S: "PREPARACAO" },
            },
            NewImage: {
              idPedido: { S: "ped-12345-abcde" },
              emailCliente: { S: "cliente.teste@ficticio.com" },
              nomeCliente: { S: "Guilherme Silva" },
              valor: { N: "249.90" },
              data: { S: new Date().toISOString() },
              status: { S: "ENVIADO" },
              referenciaNota: {
                S: "https://nfe.ecommerce.com/visualizar/12345",
              },
              dataEnvio: { S: new Date().toISOString() },
            },
          },
        },
      ],
    };
    await handler(eventoEnviado);
    console.log("Cenário 3 concluído.\n");

    // 5. Simula Cenário 4: Modificação sem mudança de status (Deverá ser ignorado)
    console.log(
      "--- CENÁRIO 4: Modificação de outro campo sem alteração de status (Deverá ser ignorado) ---",
    );
    const eventoSemMudanca: DynamoDBStreamEvent = {
      Records: [
        {
          eventID: "event-id-004",
          eventName: "MODIFY",
          dynamodb: {
            OldImage: {
              idPedido: { S: "ped-12345-abcde" },
              emailCliente: { S: "cliente.teste@ficticio.com" },
              nomeCliente: { S: "Guilherme Silva" },
              valor: { N: "249.90" },
              data: { S: new Date().toISOString() },
              status: { S: "PREPARACAO" },
            },
            NewImage: {
              idPedido: { S: "ped-12345-abcde" },
              emailCliente: { S: "cliente.teste@ficticio.com" },
              nomeCliente: { S: "Guilherme Silva" },
              valor: { N: "255.00" }, // Valor mudou, mas o status não!
              data: { S: new Date().toISOString() },
              status: { S: "PREPARACAO" },
            },
          },
        },
      ],
    };
    await handler(eventoSemMudanca);
    console.log("Cenário 4 concluído.\n");

    console.log("=== TODOS OS TESTES FORAM EXECUTADOS COM SUCESSO ===");
    console.log(
      "Dica: Você pode acessar as caixas de correio de teste em https://ethereal.email usando os dados de login mostrados acima!",
    );
  } catch (error) {
    console.error("Erro fatal durante a simulação de testes:", error);
  }
}

runTests();
