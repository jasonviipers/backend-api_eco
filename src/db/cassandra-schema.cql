-- Create keyspace
CREATE KEYSPACE IF NOT EXISTS ecommerce_analytics
WITH REPLICATION = {
  'class': 'SimpleStrategy',
  'replication_factor': 3
};

USE ecommerce_analytics;

-- Stream analytics table
CREATE TABLE IF NOT EXISTS stream_analytics (
    stream_id UUID,
    timestamp TIMESTAMP,
    user_id UUID,
    event_type TEXT,
    concurrent_viewers INT,
    revenue DECIMAL,
    product_id UUID,
    PRIMARY KEY (stream_id, timestamp)
) WITH CLUSTERING ORDER BY (timestamp DESC);

-- Chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
    stream_id UUID,
    timestamp TIMESTAMP,
    message_id UUID,
    user_id UUID,
    message TEXT,
    user_name TEXT,
    is_moderator BOOLEAN,
    PRIMARY KEY (stream_id, timestamp, message_id)
) WITH CLUSTERING ORDER BY (timestamp DESC);

-- Video views table
CREATE TABLE IF NOT EXISTS video_views (
    video_id UUID,
    timestamp TIMESTAMP,
    user_id UUID,
    event_type TEXT, -- 'view', 'like', 'share', 'comment'
    session_id UUID,
    watch_duration INT,
    device_type TEXT,
    location TEXT,
    PRIMARY KEY (video_id, timestamp, user_id)
) WITH CLUSTERING ORDER BY (timestamp DESC);

-- User activities table
CREATE TABLE IF NOT EXISTS user_activities (
    user_id UUID,
    timestamp TIMESTAMP,
    activity_type TEXT,
    entity_type TEXT, -- 'product', 'stream', 'video', 'order'
    entity_id UUID,
    metadata MAP<TEXT, TEXT>,
    PRIMARY KEY (user_id, timestamp)
) WITH CLUSTERING ORDER BY (timestamp DESC);

-- System logs table
CREATE TABLE IF NOT EXISTS system_logs (
    log_id UUID,
    timestamp TIMESTAMP,
    level TEXT,
    service TEXT,
    message TEXT,
    metadata MAP<TEXT, TEXT>,
    PRIMARY KEY (log_id, timestamp)
) WITH CLUSTERING ORDER BY (timestamp DESC);

-- Search queries table
CREATE TABLE IF NOT EXISTS search_queries (
    query_id UUID,
    timestamp TIMESTAMP,
    user_id UUID,
    query_text TEXT,
    results_count INT,
    clicked_result_id UUID,
    session_id UUID,
    PRIMARY KEY (query_id, timestamp)
) WITH CLUSTERING ORDER BY (timestamp DESC);

-- Recommendation data table
CREATE TABLE IF NOT EXISTS recommendation_data (
    user_id UUID,
    timestamp TIMESTAMP,
    item_type TEXT, -- 'product', 'video', 'stream'
    item_id UUID,
    score DOUBLE,
    algorithm TEXT,
    context MAP<TEXT, TEXT>,
    PRIMARY KEY (user_id, timestamp, item_id)
) WITH CLUSTERING ORDER BY (timestamp DESC);

-- Product analytics table
CREATE TABLE IF NOT EXISTS product_analytics (
    product_id UUID,
    date DATE,
    views INT,
    purchases INT,
    revenue DECIMAL,
    conversion_rate DOUBLE,
    avg_rating DOUBLE,
    PRIMARY KEY (product_id, date)
) WITH CLUSTERING ORDER BY (date DESC);

-- Vendor analytics table
CREATE TABLE IF NOT EXISTS vendor_analytics (
    vendor_id UUID,
    date DATE,
    total_sales DECIMAL,
    total_orders INT,
    total_views INT,
    avg_rating DOUBLE,
    commission_earned DECIMAL,
    PRIMARY KEY (vendor_id, date)
) WITH CLUSTERING ORDER BY (date DESC);

-- Real-time metrics table
CREATE TABLE IF NOT EXISTS real_time_metrics (
    metric_type TEXT,
    timestamp TIMESTAMP,
    value DOUBLE,
    metadata MAP<TEXT, TEXT>,
    PRIMARY KEY (metric_type, timestamp)
) WITH CLUSTERING ORDER BY (timestamp DESC);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS ON stream_analytics (user_id);
CREATE INDEX IF NOT EXISTS ON stream_analytics (event_type);
CREATE INDEX IF NOT EXISTS ON video_views (user_id);
CREATE INDEX IF NOT EXISTS ON video_views (event_type);
CREATE INDEX IF NOT EXISTS ON user_activities (activity_type);
CREATE INDEX IF NOT EXISTS ON search_queries (user_id);
CREATE INDEX IF NOT EXISTS ON search_queries (query_text);
