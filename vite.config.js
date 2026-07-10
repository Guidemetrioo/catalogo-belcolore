import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'save-local-api',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.method === 'POST') {
            if (req.url === '/api/save-products') {
              let body = '';
              req.on('data', chunk => { body += chunk; });
              req.on('end', () => {
                try {
                  const data = JSON.parse(body);
                  const filePath = path.resolve(__dirname, 'src/data/products.json');
                  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ success: true }));
                } catch (err) {
                  res.writeHead(500, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ error: err.message }));
                }
              });
              return;
            }
            if (req.url === '/api/upload-image') {
              let body = '';
              req.on('data', chunk => { body += chunk; });
              req.on('end', () => {
                try {
                  const payload = JSON.parse(body);
                  const { category, filename, base64Data } = payload;
                  
                  // strip base64 header
                  const base64Image = base64Data.replace(/^data:image\/\w+;base64,/, "");
                  const buffer = Buffer.from(base64Image, 'base64');
                  
                  const targetDir = path.resolve(__dirname, 'public/assets/catalog', category);
                  const targetPath = path.resolve(targetDir, filename);
                  
                  // Ensure directory exists
                  fs.mkdirSync(targetDir, { recursive: true });
                  fs.writeFileSync(targetPath, buffer);
                  
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ success: true, path: `/assets/catalog/${category}/${filename}` }));
                } catch (err) {
                  res.writeHead(500, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ error: err.message }));
                }
              });
              return;
            }
          }
          next();
        });
      }
    }
  ]
});
