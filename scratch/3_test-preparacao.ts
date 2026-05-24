// @ts-nocheck
import { handler, docClient } from "../lambdas/3_lambda-preparacao/index";
import { APIGatewayProxyEvent } from "aws-lambda";

async function runTests() {
  console.log("=== INICIANDO SIMULAÇÃO LOCAL DA LAMBDA-PREPARAÇÃO ===");

  // 1. Mocka a chamada .send do DynamoDB DocumentClient
  docClient.send = async (command: any): Promise<any> => {
    const idPedido = command.input.Key.idPedido;
    console.log(`[Mock DynamoDB] Recebido UpdateCommand para o pedido: ${idPedido}`);

    if (idPedido === "ped-inexistente-999") {
      // Simula a falha de condição do DynamoDB (registro inexistente)
      const error = new Error("Conditional check failed");
      error.name = "ConditionalCheckFailedException";
      throw error;
    }

    if (idPedido === "ped-erro-500") {
      // Simula uma falha genérica de conexão ou banco
      throw new Error("Conexão perdida com a base de dados.");
    }

    // Caso de Sucesso: retorna o objeto atualizado
    return {
      Attributes: {
        idPedido,
        emailCliente: "cliente.teste@provedor.com",
        nomeCliente: "Juliana Santos",
        valor: 450.90,
        data: new Date().toISOString(),
        status: "PREPARACAO" // Status alterado para PREPARACAO
      }
    };
  };

  let testesPassaram = true;

  // --- CENÁRIO 1: Sucesso (Pedido existente e válido) ---
  console.log("\n--- CENÁRIO 1: Atualização com Sucesso (Status 200) ---");
  const eventoSucesso: APIGatewayProxyEvent = {
    body: JSON.stringify({ idPedido: "ped-existente-123" }),
    httpMethod: "POST",
    path: "/pedidos/preparacao"
  } as any;

  const resSucesso = await handler(eventoSucesso);
  console.log(`Resultado obtido: Status Code ${resSucesso.statusCode}`);
  const bodySucesso = JSON.parse(resSucesso.body);

  if (
    resSucesso.statusCode === 200 &&
    resSucesso.headers["Access-Control-Allow-Origin"] === "*" &&
    (bodySucesso.pedido.status === "PREPARACAO" || bodySucesso.pedido.Status === "PREPARACAO")
  ) {
    console.log("✅ Cenário 1 Passou! Pedido atualizado com sucesso e CORS habilitado.");
  } else {
    console.error("❌ Cenário 1 Falhou!", resSucesso);
    testesPassaram = false;
  }

  // --- CENÁRIO 2: Validação (Corpo vazio) ---
  console.log("\n--- CENÁRIO 2: Corpo da Requisição Ausente (Status 400) ---");
  const eventoSemCorpo: APIGatewayProxyEvent = {
    body: null,
    httpMethod: "POST",
    path: "/pedidos/preparacao"
  } as any;

  const resSemCorpo = await handler(eventoSemCorpo);
  console.log(`Resultado obtido: Status Code ${resSemCorpo.statusCode}`);

  if (resSemCorpo.statusCode === 400) {
    console.log("✅ Cenário 2 Passou! Rejeitou corpo vazio corretamente.");
  } else {
    console.error("❌ Cenário 2 Falhou!", resSemCorpo);
    testesPassaram = false;
  }

  // --- CENÁRIO 3: Validação (idPedido ausente no payload) ---
  console.log("\n--- CENÁRIO 3: idPedido Ausente no Corpo JSON (Status 400) ---");
  const eventoSemId: APIGatewayProxyEvent = {
    body: JSON.stringify({ outroCampo: "teste" }),
    httpMethod: "POST",
    path: "/pedidos/preparacao"
  } as any;

  const resSemId = await handler(eventoSemId);
  console.log(`Resultado obtido: Status Code ${resSemId.statusCode}`);

  if (resSemId.statusCode === 400) {
    console.log("✅ Cenário 3 Passou! Rejeitou payload sem ID corretamente.");
  } else {
    console.error("❌ Cenário 3 Falhou!", resSemId);
    testesPassaram = false;
  }

  // --- CENÁRIO 4: Erro 404 (Pedido inexistente no banco) ---
  console.log("\n--- CENÁRIO 4: Pedido Inexistente no DynamoDB (Status 404) ---");
  const eventoInexistente: APIGatewayProxyEvent = {
    body: JSON.stringify({ idPedido: "ped-inexistente-999" }),
    httpMethod: "POST",
    path: "/pedidos/preparacao"
  } as any;

  const resInexistente = await handler(eventoInexistente);
  console.log(`Resultado obtido: Status Code ${resInexistente.statusCode}`);

  if (resInexistente.statusCode === 404) {
    console.log("✅ Cenário 4 Passou! Retornou erro 404 (Pedido Não Encontrado) corretamente.");
  } else {
    console.error("❌ Cenário 4 Falhou!", resInexistente);
    testesPassaram = false;
  }

  // --- CENÁRIO 5: Erro 500 (Falha de conexão / banco) ---
  console.log("\n--- CENÁRIO 5: Erro de Conexão no Banco (Status 500) ---");
  const eventoErroDb: APIGatewayProxyEvent = {
    body: JSON.stringify({ IdPedido: "ped-erro-500" }), // Testa casing PascalCase no erro também
    httpMethod: "POST",
    path: "/pedidos/preparacao"
  } as any;

  const resErroDb = await handler(eventoErroDb);
  console.log(`Resultado obtido: Status Code ${resErroDb.statusCode}`);

  if (resErroDb.statusCode === 500) {
    console.log("✅ Cenário 5 Passou! Capturou erro interno e retornou 500 amigável.");
  } else {
    console.error("❌ Cenário 5 Falhou!", resErroDb);
    testesPassaram = false;
  }

  // --- RESUMO FINAL ---
  if (testesPassaram) {
    console.log("\n🏆 PARABÉNS! TODOS OS CENÁRIOS DE TESTE DA LAMBDA-PREPARAÇÃO PASSARAM COM EXCELÊNCIA!");
  } else {
    console.error("\n⚠️ ALGUNS TESTES FALHARAM. REVISE AS MENSAGENS ACIMA.");
  }
}

runTests();
