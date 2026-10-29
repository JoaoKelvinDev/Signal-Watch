import { openDatabase } from "./client";

let connection: ReturnType<typeof openDatabase> | undefined;
// Um pool por runtime aquecido. Não encerrar o pool compartilhado ao terminar cada resposta.
export function getRequestDatabase() {
  connection ??= openDatabase();
  return connection.db;
}
