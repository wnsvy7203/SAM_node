import 'dotenv/config';

export const PORT = Number(process.env.PORT || 8080);
export const TARGET_URL = process.env.TARGET_URL || 'https://amoremall.com/kr/ko/aibc/web/';
if (!TARGET_URL) {
  console.error('[ENV] TARGET_URL is not set');
  process.exit(1);
}