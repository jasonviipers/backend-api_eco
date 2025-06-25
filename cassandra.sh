#!/bin/bash

# Start Cassandra in the background
docker-entrypoint.sh cassandra -f &
CASSANDRA_PID=$!

# Wait for Cassandra to be ready
echo "Waiting for Cassandra to start..."
for i in {1..60}; do
    if cqlsh -u cassandra -p cassandra -e 'DESCRIBE KEYSPACES' 2>/dev/null; then
        echo "Cassandra is ready!"
        break
    fi
    echo "Attempt $i/60: Cassandra not ready yet, waiting..."
    sleep 5
done

# Initialize schema if ready
if cqlsh -u cassandra -p cassandra -e 'DESCRIBE KEYSPACES' 2>/dev/null; then
    echo "Initializing schema..."
    if [ -f /docker-entrypoint-initdb.d/init.cql ]; then
        cqlsh -u cassandra -p cassandra -f /docker-entrypoint-initdb.d/init.cql
        echo "Schema initialization complete"
    fi
else
    echo "Failed to connect to Cassandra after 5 minutes"
    exit 1
fi

# Wait for Cassandra process to finish
wait $CASSANDRA_PID