FROM node:24-bookworm

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN DATABASE_URL=mongodb://localhost:27017/online_exam npx prisma generate
RUN npm run build
EXPOSE 3000
CMD ["npm", "run", "start:prod"]
