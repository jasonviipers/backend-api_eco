import { Client } from "cassandra-driver";
import { logger } from "../utils/logger";

let client: Client;

export const connectCassandra = async (useKeyspace: boolean = true): Promise<void> => {
  const maxRetries = 10;
  const retryDelay = 5000; // 5 seconds
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const clientConfig: any = {
        contactPoints: [process.env.CASSANDRA_HOST || "cassandra"],
        localDataCenter: process.env.CASSANDRA_DATACENTER || "datacenter1",
        credentials: {
          username: process.env.CASSANDRA_USERNAME || "cassandra",
          password: process.env.CASSANDRA_PASSWORD || "cassandra",
        },
        socketOptions: {
          connectTimeout: 30000 // 30 seconds timeout
        }
      };

      // Only add keyspace if requested (after migrations)
      if (useKeyspace) {
        clientConfig.keyspace = process.env.CASSANDRA_KEYSPACE || "ecommerce_analytics";
      }

      client = new Client(clientConfig);

      await client.connect();
      logger.info(`Cassandra connected successfully${useKeyspace ? ` with keyspace: ${clientConfig.keyspace}` : ' (no keyspace)'}`);
      return;
    } catch (error) {
      logger.warn(`Cassandra connection attempt ${attempt}/${maxRetries} failed`);
      if (attempt === maxRetries) {
        logger.error("Final Cassandra connection failed:", error);
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
};

export const getCassandraClient = (): Client => {
	if (!client) {
		throw new Error("Cassandra client not initialized");
	}
	return client;
};

export const executeQuery = async (
	query: string,
	params?: any[],
): Promise<any> => {
	try {
		const result = await client.execute(query, params);
		return result;
	} catch (error) {
		logger.error("Cassandra query failed:", error);
		throw error;
	}
};

export const reconnectWithKeyspace = async (): Promise<void> => {
  if (client) {
    await client.shutdown();
  }
  await connectCassandra(true);
};