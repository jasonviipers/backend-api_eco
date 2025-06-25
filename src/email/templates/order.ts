import { emailConfig } from "../email";

export const orderConfirmationEmail = (
  user: { name: string; email: string },
  order: { orderNumber: string; total: number; items: any[] }
) => ({
  to: user.email,
  subject: `Order Confirmation - #${order.orderNumber}`,
  html: `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #10B981; padding: 20px; text-align: center; color: white; }
        .content { padding: 20px; background-color: #f9f9f9; }
        .order-summary { 
          background-color: white; 
          padding: 20px; 
          margin: 20px 0; 
          border-radius: 8px;
          border: 1px solid #E5E7EB;
        }
        .order-item { 
          display: flex; 
          justify-content: space-between; 
          padding: 10px 0;
          border-bottom: 1px solid #E5E7EB;
        }
        .order-item:last-child { border-bottom: none; }
        .total { 
          font-weight: bold; 
          font-size: 18px; 
          text-align: right; 
          margin-top: 15px;
        }
        .shipping-info { 
          background-color: #ECFDF5; 
          padding: 15px; 
          border-left: 4px solid #10B981; 
          margin: 20px 0; 
        }
        .footer { margin-top: 20px; font-size: 12px; text-align: center; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Order Confirmation</h1>
          <p>Order #${order.orderNumber}</p>
        </div>
        <div class="content">
          <p>Hello ${user.name},</p>
          <p>Thank you for your order! We've received it and are processing it now.</p>
          
          <div class="order-summary">
            <h3>Order Summary</h3>
            ${order.items.map(item => `
              <div class="order-item">
                <div>
                  <strong>${item.name}</strong><br>
                  <small>Quantity: ${item.quantity}</small>
                </div>
                <div>$${item.price.toFixed(2)}</div>
              </div>
            `).join('')}
            
            <div class="total">
              Total: $${order.total.toFixed(2)}
            </div>
          </div>
          
          <div class="shipping-info">
            <p><strong>Shipping Information</strong></p>
            <p>Your order will be shipped to the address you provided during checkout.</p>
            <p>You'll receive another email with tracking information once your order ships.</p>
          </div>
          
          <p>If you have any questions about your order, please reply to this email.</p>
          
          <p>Best regards,<br/>The ${emailConfig.appName} Team</p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} ${emailConfig.appName}. All rights reserved.</p>
          <p>Need help? Contact <a href="mailto:${emailConfig.supportEmail}">customer support</a></p>
        </div>
      </div>
    </body>
    </html>
  `,
  text: `
    Order Confirmation - #${order.orderNumber}
    
    Hello ${user.name},
    
    Thank you for your order! We've received it and are processing it now.
    
    Order Summary:
    ${order.items.map(item => `
    - ${item.name} (Qty: ${item.quantity}) - $${item.price.toFixed(2)}
    `).join('')}
    
    Total: $${order.total.toFixed(2)}
    
    Shipping Information:
    Your order will be shipped to the address you provided during checkout.
    You'll receive another email with tracking information once your order ships.
    
    If you have any questions about your order, please reply to this email.
    
    Best regards,
    The ${emailConfig.appName} Team
    
    ---
    © ${new Date().getFullYear()} ${emailConfig.appName}. All rights reserved.
    Need help? Contact customer support at ${emailConfig.supportEmail}
  `
});

export const orderShippedEmail = (
  user: { name: string; email: string },
  order: { orderNumber: string; trackingNumber?: string; carrier?: string }
) => ({
  to: user.email,
  subject: `Your Order Has Shipped - #${order.orderNumber}`,
  html: `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #3B82F6; padding: 20px; text-align: center; color: white; }
        .content { padding: 20px; background-color: #f9f9f9; }
        .tracking-info { 
          background-color: white; 
          padding: 20px; 
          margin: 20px 0; 
          border-radius: 8px;
          border: 1px solid #E5E7EB;
          text-align: center;
        }
        .tracking-number {
          font-size: 24px;
          font-weight: bold;
          color: #3B82F6;
          margin: 10px 0;
        }
        .footer { margin-top: 20px; font-size: 12px; text-align: center; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Your Order Has Shipped</h1>
          <p>Order #${order.orderNumber}</p>
        </div>
        <div class="content">
          <p>Hello ${user.name},</p>
          <p>Great news! Your order has shipped and is on its way to you.</p>
          
          ${order.trackingNumber ? `
          <div class="tracking-info">
            <p><strong>Tracking Information</strong></p>
            <div class="tracking-number">${order.trackingNumber}</div>
            ${order.carrier ? `<p>Carrier: ${order.carrier}</p>` : ''}
            <p>You can track your package using the link above.</p>
          </div>
          ` : ''}
          
          <p>We hope you enjoy your purchase! If you have any questions, please reply to this email.</p>
          
          <p>Best regards,<br/>The ${emailConfig.appName} Team</p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} ${emailConfig.appName}. All rights reserved.</p>
          <p>Need help? Contact <a href="mailto:${emailConfig.supportEmail}">customer support</a></p>
        </div>
      </div>
    </body>
    </html>
  `,
  text: `
    Your Order Has Shipped - #${order.orderNumber}
    
    Hello ${user.name},
    
    Great news! Your order has shipped and is on its way to you.
    
    ${order.trackingNumber ? `
    Tracking Information:
    Tracking Number: ${order.trackingNumber}
    ${order.carrier ? `Carrier: ${order.carrier}` : ''}
    ` : ''}
    
    We hope you enjoy your purchase! If you have any questions, please reply to this email.
    
    Best regards,
    The ${emailConfig.appName} Team
    
    ---
    © ${new Date().getFullYear()} ${emailConfig.appName}. All rights reserved.
    Need help? Contact customer support at ${emailConfig.supportEmail}
  `
});

export const refundNotificationEmail = (
  user: { name: string; email: string },
  refund: { orderNumber: string; amount: number; reason?: string }
) => ({
  to: user.email,
  subject: `Refund Processed - Order #${refund.orderNumber}`,
  html: `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #3B82F6; padding: 20px; text-align: center; color: white; }
        .content { padding: 20px; background-color: #f9f9f9; }
        .refund-details { 
          background-color: white; 
          padding: 20px; 
          margin: 20px 0; 
          border-radius: 8px;
          border: 1px solid #E5E7EB;
        }
        .refund-amount {
          font-size: 24px;
          font-weight: bold;
          color: #10B981;
          margin: 10px 0;
        }
        .footer { margin-top: 20px; font-size: 12px; text-align: center; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Refund Processed</h1>
          <p>Order #${refund.orderNumber}</p>
        </div>
        <div class="content">
          <p>Hello ${user.name},</p>
          <p>Your refund request has been processed successfully.</p>
          
          <div class="refund-details">
            <h3>Refund Details</h3>
            <p><strong>Order Number:</strong> #${refund.orderNumber}</p>
            <div class="refund-amount">$${refund.amount.toFixed(2)}</div>
            ${refund.reason ? `<p><strong>Reason:</strong> ${refund.reason}</p>` : ''}
            <p>The refund should appear in your account within 5-10 business days.</p>
          </div>
          
          <p>If you have any questions about this refund, please reply to this email.</p>
          
          <p>Best regards,<br/>The ${emailConfig.appName} Team</p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} ${emailConfig.appName}. All rights reserved.</p>
          <p>Need help? Contact <a href="mailto:${emailConfig.supportEmail}">customer support</a></p>
        </div>
      </div>
    </body>
    </html>
  `,
  text: `
    Refund Processed - Order #${refund.orderNumber}
    
    Hello ${user.name},
    
    Your refund request has been processed successfully.
    
    Refund Details:
    - Order Number: #${refund.orderNumber}
    - Amount: $${refund.amount.toFixed(2)}
    ${refund.reason ? `- Reason: ${refund.reason}\n` : ''}
    
    The refund should appear in your account within 5-10 business days.
    
    If you have any questions about this refund, please reply to this email.
    
    Best regards,
    The ${emailConfig.appName} Team
    
    ---
    © ${new Date().getFullYear()} ${emailConfig.appName}. All rights reserved.
    Need help? Contact customer support at ${emailConfig.supportEmail}
  `
});
