// @ts-nocheck
import express from "express";
import { handler, docClient } from "../lambdas/2_lambda-envio/index";

async function runTests() {
  console.log("=== INICIANDO SIMULAÇÃO LOCAL DA LAMBDA-ENVIO ===");

  const app = express();
  app.use(express.json());

  const webhooksRecebidos: any[] = [];

  // 1. Registra o endpoint do webhook local de teste
  app.post("/webhook-receiver", (req, res) => {
    console.log(`[Express Webhook] Recebida chamada HTTP POST:`, req.body);
    webhooksRecebidos.push(req.body);
    res.status(200).json({ status: "OK", timestamp: new Date().toISOString() });
  });

  const PORT = 3001;
  const server = app.listen(PORT, async () => {
    console.log(`[Express Webhook] Servidor de testes rodando na porta ${PORT}`);

    // Configura as variáveis de ambiente necessárias
    process.env.WEBHOOK_URL = `http://localhost:${PORT}/webhook-receiver`;
    process.env.DYNAMODB_TABLE_NAME = "pedidos";

    // 2. Mocka a função .send do docClient do DynamoDB para simular a varredura sem banco físico
    console.log("[Mock DynamoDB] Interceptando chamadas de Scan...");
    
    const agora = Date.now();
    const umMinutoAtras = new Date(agora - 1 * 60 * 1000).toISOString(); // Recente (não deve notificar)
    const seisMinutosAtras = new Date(agora - 6 * 60 * 1000).toISOString(); // Parado (DEVE notificar)
    const dezMinutosAtras = new Date(agora - 10 * 60 * 1000).toISOString(); // Parado (DEVE notificar)
    
    docClient.send = async (command: any): Promise<any> => {
      console.log(`[Mock DynamoDB] Scan interceptado para a tabela: ${command.input.TableName}`);
      return {
        Items: [
          {
            idPedido: "ped-recente-1",
            data: umMinutoAtras,
            status: "RECEBIMENTO"
          },
          {
            IdPedido: "ped-parado-2", // Testa compatibilidade de PascalCase
            Data: seisMinutosAtras,   // Testa compatibilidade de PascalCase
            status: "RECEBIMENTO"
          },
          {
            idPedido: "ped-parado-3",
            data: dezMinutosAtras,
            Status: "RECEBIDO" // Testa compatibilidade com RECEBIDO
          }
        ]
      };
    };

    try {
      // 3. Dispara o handler da Lambda Envio
      console.log("[Lambda Envio] Executando handler...");
      await handler();

      // 4. Validação dos Resultados
      console.log("\n=== VERIFICANDO ASSERTIVIDADE DO FILTRO DE 4 MINUTOS ===");
      console.log(`Total de Webhooks recebidos no servidor: ${webhooksRecebidos.length}`);
      
      const IDsRecebidos = webhooksRecebidos.map(w => w.idPedido);
      console.log("IDs dos pedidos notificados:", IDsRecebidos);

      const contemRecente = IDsRecebidos.includes("ped-recente-1");
      const contemParado2 = IDsRecebidos.includes("ped-parado-2");
      const contemParado3 = IDsRecebidos.includes("ped-parado-3");

      let testesPassaram = true;

      if (contemRecente) {
        console.error("❌ ERRO: O pedido recente 'ped-recente-1' (criado há 1 min) foi notificado indevidamente!");
        testesPassaram = false;
      } else {
        console.log("✅ Sucesso: O pedido recente 'ped-recente-1' foi ignorado corretamente.");
      }

      if (!contemParado2) {
        console.error("❌ ERRO: O pedido parado 'ped-parado-2' (criado há 6 min, PascalCase) NÃO foi notificado!");
        testesPassaram = false;
      } else {
        console.log("✅ Sucesso: O pedido parado 'ped-parado-2' foi notificado com sucesso.");
      }

      if (!contemParado3) {
        console.error("❌ ERRO: O pedido parado 'ped-parado-3' (criado há 10 min, status RECEBIDO) NÃO foi notificado!");
        testesPassaram = false;
      } else {
        console.log("✅ Sucesso: O pedido parado 'ped-parado-3' foi notificado com sucesso.");
      }

      if (testesPassaram && webhooksRecebidos.length === 2) {
        console.log("\n🏆 PARABÉNS! TODOS OS TESTES PASSARAM COM EXCELÊNCIA!");
      } else {
        console.error("\n⚠️ ALGUNS TESTES FALHARAM. VERIFIQUE OS ERROS ACIMA.");
      }

    } catch (error) {
      console.error("Erro durante a execução do handler:", error);
    } finally {
      // 5. Encerra o servidor express limpo
      console.log("\n[Express Webhook] Fechando servidor de testes...");
      server.close(() => {
        console.log("Servidor encerrado. Testes finalizados.");
      });
    }
  });
}

runTests();
