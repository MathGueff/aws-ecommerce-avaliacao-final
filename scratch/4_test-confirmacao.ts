// @ts-nocheck
import { handler, docClient, s3Client } from "../lambdas/4_lambda-confirmacao/index";
import { S3Event } from "aws-lambda";

async function runTests() {
  console.log("=== INICIANDO SIMULAÇÃO LOCAL DA LAMBDA-CONFIRMAÇÃO ===");

  // 1. Mocka a chamada .send do S3Client (para simular HeadObjectCommand)
  s3Client.send = async (command: any): Promise<any> => {
    const key = command.input.Key;
    console.log(`[Mock S3] Recebido HeadObjectCommand para a chave: ${key}`);

    if (key === "NF-sem-meta.pdf") {
      // Retorna metadados vazios (sem idPedido)
      return { Metadata: {} };
    }

    if (key === "NF-erro.pdf") {
      // Simula um erro de conexão / acesso com o S3
      throw new Error("Acesso negado ao objeto S3 ou timeout.");
    }

    // Caso de Sucesso: retorna o metadado em letras minúsculas (padrão AWS S3!)
    return {
      Metadata: {
        idpedido: "ped-confirmado-789" // Letras minúsculas
      }
    };
  };

  // 2. Mocka a chamada .send do DynamoDB DocumentClient
  docClient.send = async (command: any): Promise<any> => {
    console.log(`[Mock DynamoDB] Recebido UpdateCommand para o pedido: ${command.input.Key.idPedido}`);
    console.log(`[Mock DynamoDB] Atributos atualizados:`, command.input.ExpressionAttributeValues);

    return {
      Attributes: {
        idPedido: command.input.Key.idPedido,
        status: "ENVIADO",
        dataEnvio: command.input.ExpressionAttributeValues[":dataEnvio"],
        referenciaNota: command.input.ExpressionAttributeValues[":referenciaNota"]
      }
    };
  };

  // --- CENÁRIO 1: Sucesso (PDF válido com metadados do pedido) ---
  console.log("\n--- CENÁRIO 1: Upload de PDF Válido (Sucesso) ---");
  // Simula uma URL de arquivo S3 encodada: espaços como '+'
  const eventoSucesso: S3Event = {
    Records: [
      {
        s3: {
          bucket: { name: "meu-bucket-pedidos" },
          object: { key: "NF-12345+pedido+especial.pdf" } // Decodifica para "NF-12345 pedido especial.pdf"
        }
      }
    ]
  } as any;

  await handler(eventoSucesso);
  console.log("Cenário 1 finalizado.");

  // --- CENÁRIO 2: Ignorar arquivos que não sejam PDF ---
  console.log("\n--- CENÁRIO 2: Upload de arquivo não PDF (Deve ignorar) ---");
  const eventoNaoPdf: S3Event = {
    Records: [
      {
        s3: {
          bucket: { name: "meu-bucket-pedidos" },
          object: { key: "avatar_cliente.png" }
        }
      }
    ]
  } as any;

  await handler(eventoNaoPdf);
  console.log("Cenário 2 finalizado.");

  // --- CENÁRIO 3: PDF existente, mas sem metadados do pedido ---
  console.log("\n--- CENÁRIO 3: PDF sem o metadado idpedido (Deve registrar erro e continuar) ---");
  const eventoSemMeta: S3Event = {
    Records: [
      {
        s3: {
          bucket: { name: "meu-bucket-pedidos" },
          object: { key: "NF-sem-meta.pdf" }
        }
      }
    ]
  } as any;

  await handler(eventoSemMeta);
  console.log("Cenário 3 finalizado.");

  // --- CENÁRIO 4: Falha na conexão com o S3 ---
  console.log("\n--- CENÁRIO 4: Falha ao obter metadados no S3 (Deve registrar erro amigavelmente) ---");
  const eventoErroS3: S3Event = {
    Records: [
      {
        s3: {
          bucket: { name: "meu-bucket-pedidos" },
          object: { key: "NF-erro.pdf" }
        }
      }
    ]
  } as any;

  await handler(eventoErroS3);
  console.log("Cenário 4 finalizado.");

  console.log("\n🏆 SIMULAÇÃO DE CENÁRIOS DA LAMBDA-CONFIRMAÇÃO CONCLUÍDA COM EXCELÊNCIA!");
}

runTests();
