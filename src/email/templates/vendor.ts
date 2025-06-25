import { emailConfig } from "../email";

export const vendorRegistrationConfirmationEmail = (
  vendor: { name: string; email: string; businessName: string }
) => ({
  to: vendor.email,
  subject: `Vendor Registration Received - ${emailConfig.appName}`,
  html: `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #4F46E5; padding: 20px; text-align: center; color: white; }
        .content { padding: 20px; background-color: #f9f9f9; }
        .info-box { 
          background-color: white; 
          padding: 20px; 
          margin: 20px 0; 
          border-radius: 8px;
          border: 1px solid #E5E7EB;
        }
        .footer { margin-top: 20px; font-size: 12px; text-align: center; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Vendor Registration Received</h1>
        </div>
        <div class="content">
          <p>Hello ${vendor.name},</p>
          <p>Thank you for submitting your vendor application to ${emailConfig.appName}!</p>
          
          <div class="info-box">
            <h3>Application Details</h3>
            <p><strong>Business Name:</strong> ${vendor.businessName}</p>
            <p><strong>Status:</strong> Pending Review</p>
          </div>
          
          <p>Our team will review your application and get back to you within 2-3 business days.</p>
          <p>You'll receive another email once your application has been processed.</p>
          
          <p>Best regards,<br/>The ${emailConfig.appName} Team</p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} ${emailConfig.appName}. All rights reserved.</p>
          <p>If you have any questions, please contact <a href="mailto:${emailConfig.supportEmail}">our support team</a>.</p>
        </div>
      </div>
    </body>
    </html>
  `,
  text: `
    Vendor Registration Received
    
    Hello ${vendor.name},
    
    Thank you for submitting your vendor application to ${emailConfig.appName}!
    
    Application Details:
    - Business Name: ${vendor.businessName}
    - Status: Pending Review
    
    Our team will review your application and get back to you within 2-3 business days.
    You'll receive another email once your application has been processed.
    
    Best regards,
    The ${emailConfig.appName} Team
    
    ---
    © ${new Date().getFullYear()} ${emailConfig.appName}. All rights reserved.
    If you have any questions, please contact our support team at ${emailConfig.supportEmail}.
  `
});

export const vendorStatusUpdateEmail = (
  vendor: { name: string; email: string; businessName: string },
  status: 'approved' | 'rejected' | 'suspended',
  reason?: string
) => {
  const statusMessages = {
    approved: {
      subject: 'Vendor Application Approved',
      message: 'Congratulations! Your vendor application has been approved.',
      action: 'You can now log in to your vendor dashboard and start adding products and creating live streams.'
    },
    rejected: {
      subject: 'Vendor Application Rejected',
      message: 'We regret to inform you that your vendor application has been rejected.',
      action: ''
    },
    suspended: {
      subject: 'Vendor Account Suspended',
      message: 'Your vendor account has been suspended.',
      action: 'Please contact our support team for more information.'
    }
  };

  const statusInfo = statusMessages[status];

  return {
    to: vendor.email,
    subject: `${statusInfo.subject} - ${emailConfig.appName}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { 
            background-color: ${
              status === 'approved' ? '#10B981' : 
              status === 'rejected' ? '#EF4444' : '#F59E0B'
            }; 
            padding: 20px; 
            text-align: center; 
            color: white; 
          }
          .content { padding: 20px; background-color: #f9f9f9; }
          .status-box { 
            background-color: white; 
            padding: 20px; 
            margin: 20px 0; 
            border-radius: 8px;
            border: 2px solid ${
              status === 'approved' ? '#10B981' : 
              status === 'rejected' ? '#EF4444' : '#F59E0B'
            };
            text-align: center;
          }
          .status-icon {
            font-size: 48px;
            color: ${
              status === 'approved' ? '#10B981' : 
              status === 'rejected' ? '#EF4444' : '#F59E0B'
            };
            margin-bottom: 15px;
          }
          .reason-box {
            background-color: ${
              status === 'approved' ? '#ECFDF5' : 
              status === 'rejected' ? '#FEF2F2' : '#FFFBEB'
            };
            padding: 15px;
            border-left: 4px solid ${
              status === 'approved' ? '#10B981' : 
              status === 'rejected' ? '#EF4444' : '#F59E0B'
            };
            margin: 20px 0;
          }
          .footer { margin-top: 20px; font-size: 12px; text-align: center; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${statusInfo.subject}</h1>
          </div>
          <div class="content">
            <p>Hello ${vendor.name},</p>
            
            <div class="status-box">
              <div class="status-icon">${
                status === 'approved' ? '✓' : 
                status === 'rejected' ? '✗' : '⚠'
              }</div>
              <h2>${statusInfo.message}</h2>
              <p>Business: ${vendor.businessName}</p>
            </div>
            
            ${reason ? `
              <div class="reason-box">
                <p><strong>${status === 'approved' ? 'Notes:' : 'Reason:'}</strong></p>
                <p>${reason}</p>
              </div>
            ` : ''}
            
            ${statusInfo.action ? `<p>${statusInfo.action}</p>` : ''}
            
            <p>Best regards,<br/>The ${emailConfig.appName} Team</p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} ${emailConfig.appName}. All rights reserved.</p>
            <p>If you have any questions, please contact <a href="mailto:${emailConfig.supportEmail}">our support team</a>.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `
      ${statusInfo.subject}
      
      Hello ${vendor.name},
      
      ${statusInfo.message}
      
      Business: ${vendor.businessName}
      
      ${reason ? `
      ${status === 'approved' ? 'Notes:' : 'Reason:'}
      ${reason}
      ` : ''}
      
      ${statusInfo.action ? statusInfo.action : ''}
      
      Best regards,
      The ${emailConfig.appName} Team
      
      ---
      © ${new Date().getFullYear()} ${emailConfig.appName}. All rights reserved.
      If you have any questions, please contact our support team at ${emailConfig.supportEmail}.
    `
  };
};

export const vendorPayoutNotificationEmail = (
  vendor: { name: string; email: string },
  payout: { amount: number; status: string; payoutId: string }
) => ({
  to: vendor.email,
  subject: `Payout ${payout.status} - ${emailConfig.appName}`,
  html: `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { 
          background-color: ${
            payout.status === 'completed' ? '#10B981' : 
            payout.status === 'failed' ? '#EF4444' : '#3B82F6'
          }; 
          padding: 20px; 
          text-align: center; 
          color: white; 
        }
        .content { padding: 20px; background-color: #f9f9f9; }
        .payout-box { 
          background-color: white; 
          padding: 20px; 
          margin: 20px 0; 
          border-radius: 8px;
          border: 1px solid #E5E7EB;
        }
        .payout-amount {
          font-size: 24px;
          font-weight: bold;
          color: ${
            payout.status === 'completed' ? '#10B981' : 
            payout.status === 'failed' ? '#EF4444' : '#3B82F6'
          };
        }
        .footer { margin-top: 20px; font-size: 12px; text-align: center; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Payout ${payout.status.charAt(0).toUpperCase() + payout.status.slice(1)}</h1>
        </div>
        <div class="content">
          <p>Hello ${vendor.name},</p>
          
          <div class="payout-box">
            <h3>Payout Details</h3>
            <p><strong>Status:</strong> ${payout.status.charAt(0).toUpperCase() + payout.status.slice(1)}</p>
            <p><strong>Amount:</strong> <span class="payout-amount">$${payout.amount.toFixed(2)}</span></p>
            <p><strong>Reference ID:</strong> ${payout.payoutId}</p>
          </div>
          
          ${
            payout.status === 'completed' 
              ? '<p>The funds should appear in your account within 3-5 business days.</p>'
              : payout.status === 'failed'
              ? '<p>There was an issue processing your payout. Our team has been notified and will contact you shortly.</p>'
              : '<p>Your payout request is being processed. You\'ll receive another notification once it\'s completed.</p>'
          }
          
          <p>Best regards,<br/>The ${emailConfig.appName} Team</p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} ${emailConfig.appName}. All rights reserved.</p>
          <p>If you have any questions, please contact <a href="mailto:${emailConfig.supportEmail}">our support team</a>.</p>
        </div>
      </div>
    </body>
    </html>
  `,
  text: `
    Payout ${payout.status.charAt(0).toUpperCase() + payout.status.slice(1)}
    
    Hello ${vendor.name},
    
    Payout Details:
    - Status: ${payout.status.charAt(0).toUpperCase() + payout.status.slice(1)}
    - Amount: $${payout.amount.toFixed(2)}
    - Reference ID: ${payout.payoutId}
    
    ${
      payout.status === 'completed' 
        ? 'The funds should appear in your account within 3-5 business days.'
        : payout.status === 'failed'
        ? 'There was an issue processing your payout. Our team has been notified and will contact you shortly.'
        : 'Your payout request is being processed. You\'ll receive another notification once it\'s completed.'
    }
    
    Best regards,
    The ${emailConfig.appName} Team
    
    ---
    © ${new Date().getFullYear()} ${emailConfig.appName}. All rights reserved.
    If you have any questions, please contact our support team at ${emailConfig.supportEmail}.
  `
});