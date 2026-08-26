FROM node:20-alpine

WORKDIR /app

# ffmpeg: converte os áudios do nó de voz pra OGG/OPUS antes de enviar. Sem
# ele o Telegram mostra o áudio como arquivo anexado em vez da bolha de voz
# (ver src/telegram/voice-opus.ts).
RUN apk add --no-cache ffmpeg

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm install tsx typescript @types/node @types/express

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/

# Expose port
EXPOSE 3001

# Run with tsx (no build step needed)
CMD ["npx", "tsx", "src/index.ts"]
