/*
 SAFE_TOOLS_patched.ino
 Arduino Mega + Ethernet Shield (W5100/W5500) + MFRC522.
 Envia UID lido para o proxy HTTP local (ex: http://192.168.1.150:3001/api_register_tag?uid=...).
 Ajuste PROXY_HOST, PROXY_PORT, arduinoIp, SS_PIN e RST_PIN conforme sua rede/hardware.
*/

#include <SPI.h>
#include <Ethernet.h>
#include <MFRC522.h>

// ========== CONFIGURAÇÃO DE REDE ==========
byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0xED };

// Quando usar IP estático no Arduino (opcional)
IPAddress arduinoIp(192, 168, 100, 160);  // <<< ajuste para IP livre na sua rede
IPAddress gateway(192, 168, 1, 1);
IPAddress subnet(255, 255, 255, 0);

// HOST e PORT do PROXY que o Arduino consegue acessar via HTTP.
// Ajuste PROXY_HOST para o IP da máquina onde rodará o proxy (PC ou Raspberry)
const char PROXY_HOST[] = "192.168.100.160";  // <<< ajuste: IP do proxy
const uint16_t PROXY_PORT = 3001;          // <<< ajuste: porta do proxy

// Timeout para aguardar resposta HTTP (ms)
const unsigned long HTTP_TIMEOUT = 7000UL;

// ========== CONFIGURAÇÃO RFID (MFRC522) ==========
#define RST_PIN 5   // pino RESET do MFRC522 (ajuste)
#define SS_PIN 53   // pino SDA/SS do MFRC522 -- ajuste conforme seu wiring
MFRC522 mfrc522(SS_PIN, RST_PIN);

// ========== Ethernet cliente ==========
EthernetClient client;

// Evita reenvio muito rápido da mesma tag
unsigned long lastSend = 0;
const unsigned long sendInterval = 2000; // ms

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println(F("Iniciando..."));

  // Inicializa hardware SPI e RFID
  SPI.begin();
  mfrc522.PCD_Init();
  Serial.println(F("RFID (MFRC522) inicializado."));

  // Inicializa Ethernet: tenta DHCP primeiro
  if (Ethernet.begin(mac) == 0) {
    Serial.println(F("DHCP falhou, usando IP estático"));
    Ethernet.begin(mac, arduinoIp, gateway, gateway, subnet);
  } else {
    Serial.print(F("DHCP obtido. IP: "));
    Serial.println(Ethernet.localIP());
  }

  delay(1500);
  Serial.print(F("IP do Arduino: "));
  Serial.println(Ethernet.localIP());
  Serial.print(F("Proxy/Backend alvo: "));
  Serial.print(PROXY_HOST);
  Serial.print(F(":"));
  Serial.println(PROXY_PORT);
  Serial.println(F("Pronto."));
}

void loop() {
  // Ler UID do MFRC522
  String uid = readRFID_UID();

  if (uid.length() > 0 && (millis() - lastSend > sendInterval)) {
    Serial.print(F("Tag detectada: "));
    Serial.println(uid);
    bool ok = sendRegisterTag(uid);
    Serial.print(F("Envio para servidor: "));
    Serial.println(ok ? "OK" : "FAILED");
    lastSend = millis();
  }

  delay(100);
}

// Leitura real do MFRC522 - retorna UID em HEX (ex: "04A1B2C3")
String readRFID_UID() {
  if (!mfrc522.PICC_IsNewCardPresent()) return "";
  if (!mfrc522.PICC_ReadCardSerial()) return "";

  String uid = "";
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    if (mfrc522.uid.uidByte[i] < 0x10) uid += "0";
    uid += String(mfrc522.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();
  mfrc522.PICC_HaltA(); // finaliza leitura do cartão
  return uid;
}

// Envia GET para /api_register_tag?uid=...
bool sendRegisterTag(const String &uid) {
  // monta path e faz URL-encode simples
  String path = "/api_register_tag?uid=" + urlEncode(uid);

  Serial.print(F("Conectando ao proxy/servidor... "));
  if (!client.connect(PROXY_HOST, PROXY_PORT)) {
    Serial.println(F("FALHA na conexão"));
    client.stop();
    return false;
  }
  Serial.println(F("Conectado"));

  // Requisição HTTP
  client.print(String("GET ") + path + " HTTP/1.1\r\n");
  client.print(String("Host: ") + PROXY_HOST + ":" + String(PROXY_PORT) + "\r\n");
  client.print(F("Connection: close\r\n"));
  client.print(F("\r\n"));

  // aguardar resposta com timeout
  unsigned long start = millis();
  while (!client.available()) {
    if (millis() - start > HTTP_TIMEOUT) {
      Serial.println(F("Timeout aguardando resposta"));
      client.stop();
      return false;
    }
  }

  // ler resposta (imprime corpo)
  bool inBody = false;
  String responseBody = "";
  while (client.available()) {
    String line = client.readStringUntil('\n');
    line.trim();
    if (!inBody && line.length() == 0) {
      inBody = true;
      continue;
    }
    if (inBody) responseBody += line + "\n";
    else {
      Serial.print(F("HEAD: "));
      Serial.println(line);
    }
  }

  Serial.println(F("Resposta do servidor (body):"));
  Serial.println(responseBody);
  client.stop();
  return true;
}

// função simples para url-encode básico
String urlEncode(const String &str) {
  String encoded = "";
  for (unsigned int i = 0; i < str.length(); i++) {
    char c = str.charAt(i);
    if ( (c >= 'a' && c <= 'z') ||
         (c >= 'A' && c <= 'Z') ||
         (c >= '0' && c <= '9') ||
         c == '-' || c == '_' || c == '.' || c == '~' ) {
      encoded += c;
    } else {
      char buf[4];
      sprintf(buf, "%%%02X", (unsigned char)c);
      encoded += buf;
    }
  }
  return encoded;
}
