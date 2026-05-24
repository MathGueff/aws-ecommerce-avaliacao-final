import { S3Event, S3EventRecord } from "aws-lambda";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

// Inicializa os clientes AWS SDK v3
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
});
const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
});
export const docClient = DynamoDBDocumentClient.from(dynamoClient);
export { s3Client }; // Exporta para permitir interceptação/mocking nos testes

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || "pedidos";

/**
 * Handler principal da AWS Lambda triggered por S3 Event Notification (ObjectCreated).
 */
export const handler = async (event: S3Event): Promise<void> => {
  const records: S3EventRecord[] = event.Records;

  console.info(
    JSON.stringify({
      message: "Iniciando processamento de lote do S3 Event Notification",
      totalRecords: records.length,
    })
  );

  for (const record of records) {
    const bucketName = record.s3.bucket.name;
    const rawKey = record.s3.object.key;

    // Decodifica a chave S3 de forma segura (S3 codifica espaços como '+' e caracteres especiais como URL-encoding)
    const key = decodeURIComponent(rawKey.replace(/\+/g, " "));

    console.info(
      JSON.stringify({
        message: "Processando criação de objeto no S3",
        context: {
          bucket: bucketName,
          keyOriginal: rawKey,
          keyDecodificada: key,
        },
      })
    );

    // 1. Apenas processa arquivos PDF
    if (!key.toLowerCase().endsWith(".pdf")) {
      console.info(
        JSON.stringify({
          message: "Arquivo ignorado. A Lambda de Confirmação processa apenas arquivos PDF.",
          context: { key },
        })
      );
      continue;
    }

    try {
      // 2. Recupera metadados do arquivo no S3 via HeadObject
      console.info(
        JSON.stringify({
          message: "Buscando metadados do arquivo no S3",
          context: { bucket: bucketName, key },
        })
      );

      const headCommand = new HeadObjectCommand({
        Bucket: bucketName,
        Key: key,
      });

      const headResponse = await s3Client.send(headCommand);

      // Leitura resiliente a casings: chaves de metadados do S3 são convertidas para minúsculas pela AWS
      const idPedido = headResponse.Metadata?.idpedido ?? headResponse.Metadata?.idPedido;

      if (!idPedido) {
        console.error(
          JSON.stringify({
            message: "Falha de processamento: Atributo 'idPedido' não localizado nos metadados do arquivo S3",
            context: {
              bucket: bucketName,
              key,
              metadataRecebida: headResponse.Metadata,
            },
          })
        );
        continue;
      }

      console.info(
        JSON.stringify({
          message: "Metadado idPedido extraído com sucesso do S3",
          context: { idPedido, key },
        })
      );

      // 3. Executa atualização tripla atômica no DynamoDB
      console.info(
        JSON.stringify({
          message: "Executando transação de confirmação de envio no DynamoDB",
          context: { idPedido, tabela: TABLE_NAME },
        })
      );

      const updateCommand = new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          idPedido: idPedido,
        },
        // Atualiza Status para 'ENVIADO', DataEnvio para a data atual e atrela a chave do S3 na ReferenciaNota
        UpdateExpression: "SET #status = :novoStatus, dataEnvio = :dataEnvio, referenciaNota = :referenciaNota",
        ExpressionAttributeNames: {
          "#status": "status", // Contorna palavra reservada
        },
        ExpressionAttributeValues: {
          ":novoStatus": "ENVIADO",
          ":dataEnvio": new Date().toISOString(),
          ":referenciaNota": key, // Nome do arquivo do S3
        },
        ConditionExpression: "attribute_exists(idPedido)", // Garante que o pedido exista
        ReturnValues: "ALL_NEW",
      });

      const dbResponse = (await docClient.send(updateCommand)) as any;

      console.info(
        JSON.stringify({
          message: "Pedido finalizado e Nota Fiscal atrelada com sucesso",
          context: {
            idPedido,
            statusFinal: "ENVIADO",
            referenciaNota: key,
            dataEnvio: dbResponse.Attributes?.dataEnvio ?? dbResponse.Attributes?.DataEnvio,
          },
        })
      );

    } catch (error: any) {
      const errMsg = error.message;
      const errName = error.name;

      if (errName === "ConditionalCheckFailedException") {
        console.error(
          JSON.stringify({
            message: "Falha na integridade: Pedido contido nos metadados do S3 não foi localizado no DynamoDB",
            context: {
              key,
              error: errMsg,
            },
          })
        );
      } else {
        console.error(
          JSON.stringify({
            message: "Erro não tratado no processamento do S3 Event record",
            context: {
              bucket: bucketName,
              key,
              errorName: errName,
              errorMessage: errMsg,
              stack: error.stack,
            },
          })
        );
      }
    }
  }

  console.info(
    JSON.stringify({
      message: "Lote de S3 Event Notifications processado",
    })
  );
};
