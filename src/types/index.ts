export type OrderItem = {
	productId: string;
	productName: string;
	price: number;
	quantity: number;
	vendorId: string;
};

export type VendorOrderItem = {
	productId: string;
	productName: string;
	quantity: number;
	unitPrice: number;
	totalPrice: number;
	commissionRate: number;
	commissionAmount: number;
};

export type ProductRow = {
	id: string;
	name: string;
	price: number;
	inventory: number;
	vendor_id: string;
	commission_rate: number;
};

export type ShippingInfo = {
	carrier?: string;
	trackingNumber?: string;
	estimatedDelivery?: string;
};

export type AnalyticsRow = {
	date: Date;
	total_sales: number;
	total_orders: number;
	total_views: number;
	avg_rating: number;
	commission_earned: number;
};

export type Totals = {
	totalSales: number;
	totalOrders: number;
	totalViews: number;
	totalCommission: number;
};
