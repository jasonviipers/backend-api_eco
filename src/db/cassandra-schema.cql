-- Create keyspace for ecommerce analytics
CREATE KEYSPACE IF NOT EXISTS ecommerce_analytics
WITH REPLICATION = {
  'class': 'SimpleStrategy',
  'replication_factor': 3
};

USE ecommerce_analytics;

-- Stream analytics table - optimized for time-series queries
CREATE TABLE IF NOT EXISTS stream_analytics (
    stream_id UUID,
    timestamp TIMESTAMP,
    user_id UUID,
    event_type TEXT,
    concurrent_viewers INT,
    revenue DECIMAL,
    product_id UUID,
    session_id UUID,
    device_type TEXT,
    location TEXT,
    PRIMARY KEY (stream_id, timestamp)
) WITH CLUSTERING ORDER BY (timestamp DESC)
AND gc_grace_seconds = 864000  -- 10 days
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': 1};

-- Chat messages table - partitioned by stream for better performance
CREATE TABLE IF NOT EXISTS chat_messages (
    stream_id UUID,
    timestamp TIMESTAMP,
    message_id UUID,
    user_id UUID,
    message TEXT,
    user_name TEXT,
    is_moderator BOOLEAN,
    sentiment_score DOUBLE,
    PRIMARY KEY (stream_id, timestamp, message_id)
) WITH CLUSTERING ORDER BY (timestamp DESC)
AND gc_grace_seconds = 604800  -- 7 days
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'HOURS', 'compaction_window_size': 6};

-- Video views table - optimized for analytics queries
CREATE TABLE IF NOT EXISTS video_views (
    video_id UUID,
    timestamp TIMESTAMP,
    user_id UUID,
    event_type TEXT, -- 'view', 'like', 'share', 'comment', 'view_start', 'view_end'
    session_id UUID,
    watch_duration INT,
    device_type TEXT,
    location TEXT,
    user_agent TEXT,
    referrer TEXT,
    PRIMARY KEY (video_id, timestamp, user_id)
) WITH CLUSTERING ORDER BY (timestamp DESC)
AND gc_grace_seconds = 2592000  -- 30 days
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': 1};

-- User activities table - comprehensive user behavior tracking
CREATE TABLE IF NOT EXISTS user_activities (
    user_id UUID,
    timestamp TIMESTAMP,
    activity_type TEXT,
    entity_type TEXT, -- 'product', 'stream', 'video', 'order', 'search', 'cart'
    entity_id UUID,
    metadata MAP<TEXT, TEXT>,
    session_id UUID,
    device_type TEXT,
    PRIMARY KEY (user_id, timestamp)
) WITH CLUSTERING ORDER BY (timestamp DESC)
AND gc_grace_seconds = 2592000  -- 30 days
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': 7};

-- System logs table - application and service logs
CREATE TABLE IF NOT EXISTS system_logs (
    log_id UUID,
    timestamp TIMESTAMP,
    level TEXT,
    service TEXT,
    message TEXT,
    metadata MAP<TEXT, TEXT>,
    trace_id TEXT,
    span_id TEXT,
    PRIMARY KEY (log_id, timestamp)
) WITH CLUSTERING ORDER BY (timestamp DESC)
AND gc_grace_seconds = 604800  -- 7 days
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'HOURS', 'compaction_window_size': 1};

-- Search queries table - search analytics and optimization
CREATE TABLE IF NOT EXISTS search_queries (
    query_id UUID,
    timestamp TIMESTAMP,
    user_id UUID,
    query_text TEXT,
    results_count INT,
    clicked_result_id UUID,
    session_id UUID,
    search_type TEXT, -- 'product', 'video', 'vendor', 'general'
    filters_applied MAP<TEXT, TEXT>,
    response_time INT, -- in milliseconds
    PRIMARY KEY (query_id, timestamp)
) WITH CLUSTERING ORDER BY (timestamp DESC)
AND gc_grace_seconds = 2592000  -- 30 days
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': 1};

-- Recommendation data table - ML recommendation tracking
CREATE TABLE IF NOT EXISTS recommendation_data (
    user_id UUID,
    timestamp TIMESTAMP,
    item_type TEXT, -- 'product', 'video', 'stream', 'vendor'
    item_id UUID,
    score DOUBLE,
    algorithm TEXT,
    context MAP<TEXT, TEXT>,
    position INT, -- position in recommendation list
    was_clicked BOOLEAN,
    PRIMARY KEY (user_id, timestamp, item_id)
) WITH CLUSTERING ORDER BY (timestamp DESC)
AND gc_grace_seconds = 2592000  -- 30 days
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': 7};

-- Product analytics table - daily aggregated product metrics
CREATE TABLE IF NOT EXISTS product_analytics (
    product_id UUID,
    date DATE,
    views INT,
    unique_views INT,
    purchases INT,
    revenue DECIMAL,
    conversion_rate DOUBLE,
    avg_rating DOUBLE,
    bounce_rate DOUBLE,
    avg_time_on_page INT,
    cart_additions INT,
    wishlist_additions INT,
    PRIMARY KEY (product_id, date)
) WITH CLUSTERING ORDER BY (date DESC)
AND gc_grace_seconds = 86400  -- 1 day
AND compaction = {'class': 'SizeTieredCompactionStrategy'};

-- Vendor analytics table - daily aggregated vendor metrics
CREATE TABLE IF NOT EXISTS vendor_analytics (
    vendor_id UUID,
    date DATE,
    total_sales DECIMAL,
    total_orders INT,
    total_views INT,
    unique_visitors INT,
    avg_rating DOUBLE,
    commission_earned DECIMAL,
    new_followers INT,
    total_followers INT,
    live_stream_views INT,
    video_views INT,
    PRIMARY KEY (vendor_id, date)
) WITH CLUSTERING ORDER BY (date DESC)
AND gc_grace_seconds = 86400  -- 1 day
AND compaction = {'class': 'SizeTieredCompactionStrategy'};

-- Real-time metrics table - system-wide real-time metrics
CREATE TABLE IF NOT EXISTS real_time_metrics (
    metric_type TEXT,
    timestamp TIMESTAMP,
    value DOUBLE,
    metadata MAP<TEXT, TEXT>,
    tags SET<TEXT>,
    PRIMARY KEY (metric_type, timestamp)
) WITH CLUSTERING ORDER BY (timestamp DESC)
AND gc_grace_seconds = 3600  -- 1 hour
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'MINUTES', 'compaction_window_size': 5};

-- User sessions table - session tracking for analytics
CREATE TABLE IF NOT EXISTS user_sessions (
    session_id UUID,
    user_id UUID,
    start_time TIMESTAMP,
    end_time TIMESTAMP,
    device_type TEXT,
    browser TEXT,
    os TEXT,
    ip_address TEXT,
    location TEXT,
    referrer TEXT,
    page_views INT,
    events_count INT,
    duration INT, -- in seconds
    PRIMARY KEY (session_id, start_time)
) WITH CLUSTERING ORDER BY (start_time DESC)
AND gc_grace_seconds = 2592000  -- 30 days
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': 1};

-- Event tracking table - generic event tracking
CREATE TABLE IF NOT EXISTS event_tracking (
    event_id UUID,
    timestamp TIMESTAMP,
    event_name TEXT,
    user_id UUID,
    session_id UUID,
    properties MAP<TEXT, TEXT>,
    context MAP<TEXT, TEXT>,
    PRIMARY KEY (event_id, timestamp)
) WITH CLUSTERING ORDER BY (timestamp DESC)
AND gc_grace_seconds = 2592000  -- 30 days
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': 1};

-- Performance metrics table - application performance monitoring
CREATE TABLE IF NOT EXISTS performance_metrics (
    metric_id UUID,
    timestamp TIMESTAMP,
    endpoint TEXT,
    method TEXT,
    response_time INT,
    status_code INT,
    user_id UUID,
    session_id UUID,
    error_message TEXT,
    PRIMARY KEY (metric_id, timestamp)
) WITH CLUSTERING ORDER BY (timestamp DESC)
AND gc_grace_seconds = 604800  -- 7 days
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'HOURS', 'compaction_window_size': 1};

-- User behavior funnel table - conversion funnel analysis
CREATE TABLE IF NOT EXISTS user_behavior_funnel (
    user_id UUID,
    session_id UUID,
    timestamp TIMESTAMP,
    funnel_step TEXT,
    step_order INT,
    metadata MAP<TEXT, TEXT>,
    PRIMARY KEY (user_id, session_id, timestamp)
) WITH CLUSTERING ORDER BY (session_id ASC, timestamp ASC);
AND gc_grace_seconds = 2592000  -- 30 days
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': 7};

-- Create secondary indexes for better query performance
CREATE INDEX IF NOT EXISTS ON stream_analytics (user_id);
CREATE INDEX IF NOT EXISTS ON stream_analytics (event_type);
CREATE INDEX IF NOT EXISTS ON stream_analytics (timestamp);

CREATE INDEX IF NOT EXISTS ON video_views (user_id);
CREATE INDEX IF NOT EXISTS ON video_views (event_type);
CREATE INDEX IF NOT EXISTS ON video_views (session_id);

CREATE INDEX IF NOT EXISTS ON user_activities (activity_type);
CREATE INDEX IF NOT EXISTS ON user_activities (entity_type);
CREATE INDEX IF NOT EXISTS ON user_activities (session_id);

CREATE INDEX IF NOT EXISTS ON search_queries (user_id);
CREATE INDEX IF NOT EXISTS ON search_queries (query_text);
CREATE INDEX IF NOT EXISTS ON search_queries (search_type);

CREATE INDEX IF NOT EXISTS ON recommendation_data (item_type);
CREATE INDEX IF NOT EXISTS ON recommendation_data (algorithm);

CREATE INDEX IF NOT EXISTS ON system_logs (level);
CREATE INDEX IF NOT EXISTS ON system_logs (service);
CREATE INDEX IF NOT EXISTS ON system_logs (trace_id);

CREATE INDEX IF NOT EXISTS ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS ON user_sessions (device_type);

CREATE INDEX IF NOT EXISTS ON event_tracking (event_name);
CREATE INDEX IF NOT EXISTS ON event_tracking (user_id);
CREATE INDEX IF NOT EXISTS ON event_tracking (session_id);

CREATE INDEX IF NOT EXISTS ON performance_metrics (endpoint);
CREATE INDEX IF NOT EXISTS ON performance_metrics (status_code);

-- Create materialized views for common query patterns
CREATE MATERIALIZED VIEW IF NOT EXISTS stream_analytics_by_user AS
    SELECT user_id, timestamp, stream_id, event_type, concurrent_viewers, revenue, product_id
    FROM stream_analytics
    WHERE user_id IS NOT NULL AND timestamp IS NOT NULL AND stream_id IS NOT NULL
    PRIMARY KEY (user_id, timestamp, stream_id)
    WITH CLUSTERING ORDER BY (timestamp DESC);

CREATE MATERIALIZED VIEW IF NOT EXISTS video_views_by_user AS
    SELECT user_id, timestamp, video_id, event_type, watch_duration, device_type, location
    FROM video_views
    WHERE user_id IS NOT NULL AND timestamp IS NOT NULL AND video_id IS NOT NULL
    PRIMARY KEY (user_id, timestamp, video_id)
    WITH CLUSTERING ORDER BY (timestamp DESC);

CREATE MATERIALIZED VIEW IF NOT EXISTS search_queries_by_user AS
    SELECT user_id, timestamp, query_id, query_text, results_count, search_type
    FROM search_queries
    WHERE user_id IS NOT NULL AND timestamp IS NOT NULL AND query_id IS NOT NULL
    PRIMARY KEY (user_id, timestamp, query_id)
    WITH CLUSTERING ORDER BY (timestamp DESC);

-- Create user-defined types for complex data structures
CREATE TYPE IF NOT EXISTS recommendation_context (
    page_type TEXT,
    current_item_id UUID,
    user_preferences MAP<TEXT, TEXT>,
    session_data MAP<TEXT, TEXT>
);

CREATE TYPE IF NOT EXISTS event_properties (
    category TEXT,
    action TEXT,
    label TEXT,
    value DOUBLE,
    custom_properties MAP<TEXT, TEXT>
);