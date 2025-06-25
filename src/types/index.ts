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
