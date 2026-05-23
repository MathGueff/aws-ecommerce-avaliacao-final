import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

// Inicializa o cliente do DynamoDB
const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
});
export const docClient = DynamoDBDocumentClient.from(dynamoClient);
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || "pedidos";

// Cabeçalhos CORS padrão para permitir integrações frontend sem bloqueios
const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * Handler principal do Lambda Triggered por API Gateway (Rota HTTP POST).
 * Atualiza o status do pedido para 'PREPARACAO'.
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.info(
    JSON.stringify({
      message: "Recebida chamada para a Lambda Preparação",
      context: {
        httpMethod: event.httpMethod,
        path: event.path,
        requestId: event.requestContext?.requestId,
      },
    })
  );

  // 1. Extração e validação do payload da requisição
  let body: Record<string, any>;
  try {
    if (!event.body) {
      console.warn("Payload HTTP ausente");
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "Corpo da requisição ausente." }),
      };
    }
    body = JSON.parse(event.body);
  } catch (err: any) {
    console.error(
      JSON.stringify({
        message: "Falha ao efetuar parse do corpo JSON",
        error: err.message,
      })
    );
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Formato JSON inválido no corpo da requisição." }),
    };
  }

  // Suporta tanto "idPedido" (camelCase) quanto "IdPedido" (PascalCase) de forma tolerante
  const idPedido = body.idPedido ?? body.IdPedido;

  if (!idPedido) {
    console.warn("idPedido ausente no payload");
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Atributo 'idPedido' é obrigatório no payload." }),
    };
  }

  console.info(
    JSON.stringify({
      message: "Processando atualização de status de pedido",
      context: { idPedido, tabela: TABLE_NAME },
    })
  );

  // 2. Executa a atualização condicional no DynamoDB
  try {
    const updateCommand = new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        idPedido: idPedido,
      },
      // Status é palavra reservada no DynamoDB, então usamos ExpressionAttributeNames (#status)
      UpdateExpression: "SET #status = :novoStatus",
      ExpressionAttributeNames: {
        "#status": "Status",
      },
      ExpressionAttributeValues: {
        ":novoStatus": "PREPARACAO",
      },
      // Condição crítica: impede que o DynamoDB crie um registro corrompido/fantasma caso o ID não exista
      ConditionExpression: "attribute_exists(idPedido)",
      ReturnValues: "ALL_NEW",
    });

    const response = (await docClient.send(updateCommand)) as any;

    console.info(
      JSON.stringify({
        message: "Status do pedido atualizado com sucesso",
        context: {
          idPedido,
          novoStatus: "PREPARACAO",
        },
      })
    );

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message: "Pedido atualizado para PREPARACAO com sucesso.",
        pedido: response.Attributes,
      }),
    };
  } catch (error: any) {
    const errMsg = error.message;
    const errName = error.name;

    // Trata especificamente o erro de pedido inexistente
    if (errName === "ConditionalCheckFailedException") {
      console.warn(
        JSON.stringify({
          message: "Pedido não localizado para atualização",
          context: { idPedido, error: errMsg },
        })
      );
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: "Pedido não encontrado.",
          details: `Não existe pedido cadastrado com o ID '${idPedido}'.`,
        }),
      };
    }

    // Registra falhas gerais/internas do banco
    console.error(
      JSON.stringify({
        message: "Erro interno no DynamoDB ao atualizar pedido",
        context: {
          idPedido,
          errorName: errName,
          errorMessage: errMsg,
          stack: error.stack,
        },
      })
    );

    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "Erro interno no servidor ao processar o pedido.",
        details: errMsg,
      }),
    };
  }
};
