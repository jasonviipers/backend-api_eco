export const generateOtp = (length: string = "6") => {
	const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
	const randomString = Array.from(
		{ length: Number(length) },
		() => charset[Math.floor(Math.random() * charset.length)],
	).join("");
	return randomString;
};
