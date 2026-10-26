export interface ServerConfig {
  port: number;
  mongoUri: string | undefined;
  frontendUrl: string;
  sessionSecret?: string;
  secureCookies?: boolean;
  cloudinaryCloudName?: string;
  cloudinaryApiKey?: string;
  cloudinaryApiSecret?: string;
}

export function readConfig(): ServerConfig {
  const portValue = process.env.PORT?.trim() ?? "4000";
  const port = Number(portValue);

  if (!/^\d+$/.test(portValue) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT должен быть целым числом от 1 до 65535.");
  }

  let frontendUrl: string;
  try {
    const url = new URL(process.env.FRONTEND_URL?.trim() || "http://127.0.0.1:5173");
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash
    ) {
      throw new Error();
    }
    frontendUrl = url.origin;
  } catch {
    throw new Error("FRONTEND_URL должен содержать адрес сайта без пути, пароля и параметров.");
  }

  return {
    port,
    mongoUri: process.env.MONGO_URI?.trim() || undefined,
    frontendUrl,
    sessionSecret: process.env.SESSION_SECRET || undefined,
    secureCookies: process.env.NODE_ENV === "production",
    cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME?.trim() || undefined,
    cloudinaryApiKey: process.env.CLOUDINARY_API_KEY?.trim() || undefined,
    cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET || undefined,
  };
}
