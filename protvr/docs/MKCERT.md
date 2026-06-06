Passos rápidos para gerar certificados com `mkcert` e rodar o dev server em HTTPS

1. Instale o `mkcert` (exemplo macOS/Homebrew):

   brew install mkcert
   brew install nss # se for usar Firefox

2. Instale a autoridade local (apenas uma vez):

   mkcert -install

3. Gere certificados para `localhost` / `127.0.0.1` / `::1` e salve em `./certs`:

   mkdir -p certs
   mkcert -cert-file certs/localhost+2.pem -key-file certs/localhost+2-key.pem "localhost" 127.0.0.1 ::1

   Isso criará `certs/localhost+2.pem` e `certs/localhost+2-key.pem`.

4. Inicie o servidor em HTTPS (o `vite.config.ts` detecta os arquivos automaticamente):

   npm run dev:https

5. Acesse em https://localhost:5173 (ou porta mostrada pelo Vite). Navegadores que confiam no CA local do `mkcert` aceitarão o certificado.

Notas:

- Se quiser acessar a partir de outro dispositivo na rede (ex.: headset VR), será preciso instalar o CA local do `mkcert` nesse dispositivo, ou usar uma solução de túnel HTTPS (ngrok) em vez de certificados locais.
- Se o Vite não encontrar os arquivos em `./certs`, ele voltará para HTTP e exibirá um aviso no console.
