# Live Streaming & Short Video E-commerce Platform Backend

A comprehensive backend system for a multi-vendor live streaming and short video e-commerce platform built with Node.js, TypeScript, and a hybrid database architecture.

## 🚀 Features

### Core Features
- **Multi-vendor Support** - Complete vendor management system
- **Live Streaming** - RTMP streaming with real-time chat
- **Short Videos** - TikTok-style video platform
- **E-commerce** - Full shopping cart and order management
- **Real-time Features** - Socket.io for live updates
- **Payment Processing** - Stripe integration with multi-vendor payouts
- **Analytics** - Comprehensive analytics and reporting
- **Media Management** - Cloudinary integration with video processing

### Technical Features
- **Hybrid Database** - PostgreSQL + Cassandra for optimal performance
- **Caching** - Redis for session management and performance
- **Authentication** - JWT with refresh tokens
- **Validation** - Zod schemas for all inputs
- **File Upload** - Multer + Cloudinary integration
- **Video Processing** - FFmpeg for video optimization
- **Email System** - Nodemailer for notifications
- **Rate Limiting** - Protection against abuse
- **Error Handling** - Comprehensive error management
- **Logging** - Winston for application logging

## 🛠 Technology Stack

- **Runtime**: Bun
- **Framework**: Hono
- **Databases**: 
  - PostgreSQL (structured data)
  - Cassandra (time-series & analytics)
  - Redis (caching & sessions)
- **Authentication**: JWT + bcryptjs
- **Real-time**: Socket.io
- **File Storage**: Cloudinary
- **Payments**: Stripe
- **Video Processing**: FFmpeg
- **Streaming**: Node Media Server (RTMP)
- **Validation**: Zod
- **Email**: Nodemailer

## 📋 Prerequisites

- Node.js 18+
- PostgreSQL 15+
- Cassandra 4.1+
- Redis 7+
- FFmpeg

## 🚀 Quick Start

### 1. Clone and Install
\`\`\`bash
git clone <repository-url>
cd live-streaming-ecommerce-backend
npm install
\`\`\`

### 2. Environment Setup
\`\`\`bash
cp src/.env.example .env
# Edit .env with your configuration
\`\`\`

### 3. Database Setup

# Start databases with Docker
``` bash 
docker-compose up -d postgres cassandra redis

# Run migrations
npm run migrate
``` 

# Seed initial data
``` bash 
npm run seed
``` 

### 4. Start Development Server
``` bash 
npm run dev
``` 

The server will start on `http://localhost:5000`

## 🏗 Project Structure

``` bash  
src/
├── config/           # Database and service configurations
├── middleware/       # Express middleware
├── routes/          # API route handlers
├── schemas/         # Zod validation schemas
├── utils/           # Utility functions
├── scripts/         # Database scripts
└── server/           # Application core
└── server.ts        # Main application entry point
``` 

## 📚 API Documentation

### Authentication Endpoints
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/verify-email` - Email verification
- `POST /api/auth/forgot-password` - Password reset request
- `POST /api/auth/reset-password` - Password reset

### Product Endpoints
- `GET /api/products` - Get products with filters
- `GET /api/products/:id` - Get single product
- `POST /api/products` - Create product (vendor only)
- `PUT /api/products/:id` - Update product (vendor only)
- `DELETE /api/products/:id` - Delete product (vendor only)

### Order Endpoints
- `GET /api/orders` -  Get orders list with filters
- `GET /api/ordesr/:id` - Get order details
- `POST /api/orders` - Create orders 
- `PUT /api/orders/:id/status` - Update order status
- `POST /api/orders/:id/cancel` - Cancel order
- `POST /api/orders/:id/return` - Return order
- `GET /api/orders/:id/tracking` - Get order tracking info

### Live Stream Endpoints
- `GET /api/streams` - Get live streams
- `GET /api/streams/:id` - Get stream details
- `POST /api/streams` - Create stream (vendor only)
- `PUT /api/streams/:id/start` - Start stream
- `PUT /api/streams/:id/end` - End stream
- `GET /api/streams/:id/analytics` - Stream analytics

### Video Endpoints
- `GET /api/videos` - Get video feed
- `GET /api/videos/:id` - Get single video
- `POST /api/videos` - Upload video
- `POST /api/videos/:id/like` - Like/unlike video
- `POST /api/videos/:id/comment` - Comment on video

## 🔧 Configuration

### Database Configuration
The system uses a hybrid database approach:
- **PostgreSQL**: User data, products, orders, vendor info
- **Cassandra**: Analytics, logs, chat messages, video metrics
- **Redis**: Caching, sessions, rate limiting

### Environment Variables
Key environment variables (see `.env.example`):
- Database connections
- JWT secrets
- Stripe keys
- Cloudinary credentials
- SMTP settings
- Media server configuration

## 🎥 Live Streaming Setup

### RTMP Configuration
- Default RTMP port: 1935
- Stream URL format: `rtmp://localhost:1935/live/{stream_key}`
- Supports authentication via stream keys
- Automatic stream status management

### Video Processing
- Automatic video compression
- Thumbnail generation
- Multiple format support
- CDN integration via Cloudinary

## 💳 Payment Integration

### Stripe Setup
- Multi-vendor payment splitting
- Automatic commission calculation
- Refund processing
- Webhook handling for payment events
- Subscription support for premium features

## 📊 Analytics & Monitoring

### Real-time Analytics
- Stream viewer counts
- Video engagement metrics
- Sales performance
- User behavior tracking

### Logging
- Application logs via Winston
- Error tracking and monitoring
- Performance metrics
- Audit trails

## 🔒 Security Features

- JWT authentication with refresh tokens
- Rate limiting on all endpoints
- Input validation with Zod
- SQL injection prevention
- XSS protection
- CORS configuration
- Helmet.js security headers

## 🚀 Deployment

### Docker Deployment
# Build and start all services
``` bash
docker-compose up -d
```
# View logs
``` bash    
docker-compose logs -f app
```

### Production Considerations
- Use environment-specific configurations
- Set up SSL certificates
- Configure load balancing
- Set up monitoring and alerting
- Regular database backups
- CDN configuration for media files

## 📈 Performance Optimization

- Database indexing for frequently queried fields
- Redis caching for expensive operations
- Connection pooling for databases
- Compression middleware
- Image and video optimization
- CDN integration

## 🧪 Testing

# Run tests
``` bash  
npm test
```
# Run with coverage
``` bash  
npm run test:coverage
```

## 📝 API Rate Limits

- General API: 100 requests per 15 minutes per IP
- Authentication endpoints: 5 requests per 15 minutes per IP
- File upload: 10 requests per hour per user
- Streaming: No rate limit (handled by media server)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

## 🆘 Support

For support and questions:
- Create an issue in the repository
- Check the documentation
- Review the API examples

## 🔄 Changelog

### v1.0.0
- Initial release
- Complete backend implementation
- Multi-vendor support
- Live streaming functionality
- Short video platform
- Payment processing
- Real-time features
