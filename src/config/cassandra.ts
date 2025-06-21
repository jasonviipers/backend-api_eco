import { Client } from "cassandra-driver"
import { logger } from "../utils/logger"

let client: Client

export const connectCassandra = async (): Promise<void> => {
  try {
    client = new Client({
      contactPoints: [process.env.CASSANDRA_HOST || "localhost"],
      localDataCenter: process.env.CASSANDRA_DATACENTER || "datacenter1",
      keyspace: process.env.CASSANDRA_KEYSPACE || "ecommerce_analytics",
      credentials: {
        username: process.env.CASSANDRA_USERNAME || "cassandra",
        password: process.env.CASSANDRA_PASSWORD || "cassandra",
      },
    })

    await client.connect()
    logger.info("Cassandra connected successfully")
  } catch (error) {
    logger.error("Cassandra connection failed:", error)
    throw error
  }
}

export const getCassandraClient = (): Client => {
  if (!client) {
    throw new Error("Cassandra client not initialized")
  }
  return client
}

export const executeQuery = async (query: string, params?: any[]): Promise<any> => {
  try {
    const result = await client.execute(query, params)
    return result
  } catch (error) {
    logger.error("Cassandra query failed:", error)
    throw error
  }
}
