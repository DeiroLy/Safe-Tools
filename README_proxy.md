README - Proxy para integrar Arduino HTTP ao backend HTTPS (Render)
=================================================================

Objetivo
--------
Permitir que o Arduino (que só faz HTTP) envie requisições para o backend hospedado em HTTPS (ex: Render).
O proxy roda em uma máquina na mesma rede do Arduino (Raspberry, PC) e recebe requisições HTTP do Arduino.
Ele então repassa para o backend (HTTP ou HTTPS) preservando path e query string.

Arquivos
--------
- arduino-proxy.js           -> o proxy Node/Express
- SAFE_TOOLS_patched.ino     -> sketch Arduino pronto para MFRC522 + Ethernet
- README_proxy.md            -> este arquivo

Pré-requisitos no computador que fará de proxy
----------------------------------------------
- Node.js (versão LTS recomendada)
- Conexão de rede com o Arduino (mesma rede/sub-rede)
- Acesso à internet (se o backend estiver no Render)

Configurar e rodar (passo a passo)
---------------------------------

1) Copie os arquivos para a máquina proxy (ou execute diretamente do pendrive).

2) Abra um terminal nessa pasta e inicie o projeto:
   ```bash
   npm init -y
   npm install express node-fetch@2
