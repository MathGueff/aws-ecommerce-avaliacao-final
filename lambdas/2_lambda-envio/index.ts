import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { dispararWebhook } from "./webhookService";

// Configurações do DynamoDB
const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
});
export const docClient = DynamoDBDocumentClient.from(dynamoClient);
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || "pedidos";

// Limiar de tempo: 4 minutos em milissegundos
const QUATRO_MINUTOS_MS = 4 * 60 * 1000;

interface PedidoSimplificado {
  idPedido: string;
  data: string;
}

/**
 * Mapeia os campos do item do DynamoDB suportando camelCase e PascalCase.
 */
function extrairDadosPedido(item: Record<string, any>): PedidoSimplificado | null {
  const idPedido = item.idPedido ?? item.IdPedido;
  const data = item.data ?? item.Data;

  if (!idPedido || !data) return null;

  return {
    idPedido: String(idPedido),
    data: String(data),
  };
}

/**
 * Handler principal da AWS Lambda triggered por EventBridge Schedule (a cada 5 minutos).
 */
export const handler = async (): Promise<void> => {
  const neededEnvVars = [
    'DYNAMODB_TABLE_NAME',
    'AWS_REGION',
    'WEBHOOK_URL'
  ];

  if (
    !neededEnvVars.every(varName => process.env[varName] !== undefined)
  ) {
    console.error('Variáveis de ambiente não carregadas. Verifique o arquivo .env', { 
      envVarsMissing: neededEnvVars.filter(varName => process.env[varName] === undefined),
      envVarsLoaded: neededEnvVars.filter(varName => process.env[varName] !== undefined),
      dateNow: new Date()
    });
    throw new Error('Verifique se o arquivo .env está presente e contém as variáveis necessárias');
  }

  console.info(
    JSON.stringify({
      message: "Iniciando varredura periódica de pedidos parados",
      context: {
        tabela: TABLE_NAME,
        limiarMinutos: 4,
      },
    })
  );

  let pedidosVarridos: Record<string, any>[] = [];
  let lastEvaluatedKey: Record<string, any> | undefined = undefined;

  try {
    // 1. Executa a varredura (Scan) paginada no DynamoDB
    do {
      const scanCommand = new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "(#status = :statusRecebido OR #status = :statusRecebimento) OR (#statusUpper = :statusRecebido OR #statusUpper = :statusRecebimento)",
        ExpressionAttributeNames: {
          "#status": "status",
          "#statusUpper": "Status",
        },
        ExpressionAttributeValues: {
          ":statusRecebido": "RECEBIDO",
          ":statusRecebimento": "RECEBIMENTO",
        },
        ExclusiveStartKey: lastEvaluatedKey,
      });

      const response = (await docClient.send(scanCommand)) as any;
      if (response.Items) {
        pedidosVarridos = pedidosVarridos.concat(response.Items);
      }
      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey);

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;

    console.error(
      JSON.stringify({
        message: "Erro crítico ao efetuar Scan na tabela pedidos",
        context: {
          tabela: TABLE_NAME,
          errorMessage: errMsg,
          stack: errStack,
        },
      })
    );
    throw error; // Propaga o erro para alertar no CloudWatch Metrics
  }

  const totalEncontradosNoStatus = pedidosVarridos.length;
  const agora = Date.now();
  const pedidosParados: PedidoSimplificado[] = [];

  // 2. Filtra os pedidos criados há mais de 4 minutos no JavaScript
  for (const item of pedidosVarridos) {
    const pedido = extrairDadosPedido(item);
    if (!pedido) continue;

    try {
      const dataCriacao = new Date(pedido.data).getTime();
      if (isNaN(dataCriacao)) {
        console.warn(
          JSON.stringify({
            message: "Pedido com data de criação inválida no DynamoDB",
            context: { idPedido: pedido.idPedido, dataOriginal: pedido.data },
          })
        );
        continue;
      }

      const tempoDecorrido = agora - dataCriacao;
      if (tempoDecorrido > QUATRO_MINUTOS_MS) {
        pedidosParados.push(pedido);
      }
    } catch (err: any) {
      console.warn(
        JSON.stringify({
          message: "Erro ao processar data do pedido",
          context: { idPedido: pedido.idPedido, erro: err.message },
        })
      );
    }
  }

  const totalQualificados = pedidosParados.length;

  console.info(
    JSON.stringify({
      message: "Varredura concluída. Pedidos qualificados identificados.",
      context: {
        totalEmRecebimento: totalEncontradosNoStatus,
        totalParadosMaisQuatroMinutos: totalQualificados,
      },
    })
  );

  let totalSucesso = 0;
  let totalFalha = 0;

  // 3. Dispara as chamadas de Webhook de forma paralela porém segura (com try/catch individual)
  const webhookPromises = pedidosParados.map(async (pedido) => {
    try {
      const result = await dispararWebhook(pedido.idPedido);
      if (result.success) {
        totalSucesso++;
      } else {
        totalFalha++;
      }
    } catch (err: any) {
      totalFalha++;
      console.error(
        JSON.stringify({
          message: "Erro não tratado no disparo do webhook para o pedido",
          context: {
            idPedido: pedido.idPedido,
            erro: err.message,
          },
        })
      );
    }
  });

  // Aguarda a conclusão de todos os webhooks disparados
  await Promise.all(webhookPromises);

  // 4. Log agregado de resultados para monitoramento facilitado no CloudWatch
  console.info(
    JSON.stringify({
      message: "Execução periódica de processamento de webhooks finalizada",
      context: {
        tabela: TABLE_NAME,
        totalVarridosEmRecebimento: totalEncontradosNoStatus,
        totalQualificadosComoParados: totalQualificados,
        webhookEnviosSucesso: totalSucesso,
        webhookEnviosFalha: totalFalha,
      },
    })
  );
};
