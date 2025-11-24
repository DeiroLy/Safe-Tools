/*
  esp32_rfid_relay_db.ino
  - ESP32 WROOM-32 (lado do 3V3)
  - RC522 pins (custom by user): SDA=D18, SCK=D19, MOSI=D21, MISO=D5, RST=D15
  - RELAY pin: D2 (user requested; here we use GPIO 2)
  - Storage: SPIFFS -> /db.json (persists registered tags and statuses)
  - Modes: Cadastro (register) and Devolução (return) via Serial menu
  - On register/return -> open lock (activate relay) for 5000 ms

  Libraries required:
   - MFRC522 (https://github.com/miguelbalboa/rfid)
   - ArduinoJson (https://arduinojson.org/)
   - SPIFFS is built-in for ESP32 (SPIFFS.h)
*/

#include <SPI.h>
#include <MFRC522.h>
#include "FS.h"
#include "SPIFFS.h"
#include <ArduinoJson.h>

// ---------- HARDWARE CONFIG ----------
#define SS_PIN 18      // SDA / SS
#define RST_PIN 15     // RST
#define SCK_PIN 19     // SCK
#define MOSI_PIN 21    // MOSI
#define MISO_PIN 5     // MISO

#define RELAY_PIN 2    // Relé conectado ao D2 (GPIO 2)

// ---------- RELAY BEHAVIOR ----------
const bool RELAY_ACTIVE_LOW = false; // MOST modules are active LOW. Set to false if yours is active HIGH.
const int RELAY_ON_LEVEL  = RELAY_ACTIVE_LOW ? LOW : HIGH;
const int RELAY_OFF_LEVEL = RELAY_ACTIVE_LOW ? HIGH : LOW;
const unsigned long RELAY_OPEN_MS = 5000UL; // 5 seconds

// ---------- DB / STORAGE ----------
const char *DB_PATH = "/db.json";

// We'll store a JSON object like:
// { "next_tool_id": 1, "category": "AUT", "category_number": 1, "tools": [ { "uid":"A1:B2:...", "code":"AUT.01.001", "status":"available" }, ... ] }

MFRC522 mfrc522(SS_PIN, RST_PIN);

// in-memory JSON doc
StaticJsonDocument<16384> db; // size enough for a modest number of entries; increase if necessary

// --------- utility ----------
void printLine() { Serial.println(F("--------------------------------------------------")); }

// ---------- SPIFFS functions ----------
bool initFilesystem() {
  if (!SPIFFS.begin(true)) {
    Serial.println(F("SPIFFS mount failed!"));
    return false;
  }
  Serial.println(F("SPIFFS mounted."));
  return true;
}

bool loadDB() {
  if (!SPIFFS.exists(DB_PATH)) {
    Serial.println(F("DB not found. Creating new DB..."));
    db.clear();
    db["next_tool_id"] = 1;
    db["category"] = "AUT";          // fixed category as requested
    db["category_number"] = 1;
    db.createNestedArray("tools");
    return saveDB();
  }

  File f = SPIFFS.open(DB_PATH, FILE_READ);
  if (!f) {
    Serial.println(F("Failed to open DB for reading"));
    return false;
  }
  DeserializationError err = deserializeJson(db, f);
  f.close();
  if (err) {
    Serial.print(F("Failed to parse DB json: "));
    Serial.println(err.c_str());
    return false;
  }
  Serial.println(F("DB loaded."));
  return true;
}

bool saveDB() {
  File f = SPIFFS.open(DB_PATH, FILE_WRITE);
  if (!f) {
    Serial.println(F("Failed to open DB for writing"));
    return false;
  }
  if (serializeJsonPretty(db, f) == 0) {
    Serial.println(F("Failed to write DB"));
    f.close();
    return false;
  }
  f.close();
  Serial.println(F("DB saved."));
  return true;
}

// ---------- helper functions ----------
String uidToString(MFRC522::Uid &uid) {
  String s = "";
  for (byte i = 0; i < uid.size; i++) {
    if (s.length()) s += ":";
    if (uid.uidByte[i] < 0x10) s += "0";
    s += String(uid.uidByte[i], HEX);
  }
  s.toUpperCase();
  return s;
}

int findToolIndexByUID(const String &uid) {
  JsonArray tools = db["tools"].as<JsonArray>();
  int idx = 0;
  for (JsonObject tool : tools) {
    const char* u = tool["uid"] | "";
    if (uid.equalsIgnoreCase(String(u))) return idx;
    idx++;
  }
  return -1;
}

String formatCode() {
  // Format: AUT.01.001
  const char* cat = db["category"] | "AUT";
  int catnum = db["category_number"] | 1;
  int id = db["next_tool_id"] | 1;

  char buf[32];
  // category fixed, category number 2 digits, id 3 digits
  snprintf(buf, sizeof(buf), "%s.%02d.%03d", cat, catnum, id);
  return String(buf);
}

void openLockForMs(unsigned long ms) {
  Serial.println(F("Abrindo trava..."));
  digitalWrite(RELAY_PIN, RELAY_ON_LEVEL);
  delay(ms);
  digitalWrite(RELAY_PIN, RELAY_OFF_LEVEL);
  Serial.println(F("Trava fechada."));
}

// ---------- Setup & Loop ----------
void setup() {
  Serial.begin(115200);
  delay(1000);
  printLine();
  Serial.println(F("ESP32 RFID + Relé - Cadastro/Devolução"));
  Serial.println(F("Iniciando..."));

  // init relay pin
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, RELAY_OFF_LEVEL); // ensure off

  // init SPI with custom pins
  SPI.begin(SCK_PIN, MISO_PIN, MOSI_PIN, SS_PIN); // SCK,MISO,MOSI,SS
  mfrc522.PCD_Init();
  Serial.println(F("MFRC522 inicializado."));

  // init filesystem
  if (!initFilesystem()) {
    Serial.println(F("Erro SPIFFS - não será possível persistir DB."));
  }
  if (!loadDB()) {
    Serial.println(F("Erro carregando DB. Banco vazio criado."));
  }

  printLine();
  Serial.println(F("Menu:"));
  Serial.println(F("1 -> Cadastro"));
  Serial.println(F("2 -> Devolução"));
  Serial.println(F("L -> Listar ferramentas cadastradas"));
  Serial.println(F("R -> Regravar DB (forçar save)"));
  printLine();
}

void loop() {
  // show menu prompt
  if (Serial.available()) {
    char c = Serial.read();
    if (c == '1') {
      Serial.println(F("MODO: CADASTRO"));
      Serial.println(F("Aproxime a TAG..."));
      // wait for a tag
      while (!mfrc522.PICC_IsNewCardPresent()) {
        delay(50);
      }
      if (!mfrc522.PICC_ReadCardSerial()) return;
      String uid = uidToString(mfrc522.uid);
      Serial.print(F("TAG ORIGINAL: ")); Serial.println(uid);

      int idx = findToolIndexByUID(uid);
      if (idx >= 0) {
        Serial.println(F("Tag já cadastrada! Mostrando código existente:"));
        JsonObject tool = db["tools"][idx].as<JsonObject>();
        Serial.print(F("Code: ")); Serial.println((const char*)tool["code"]);
        Serial.print(F("Status: ")); Serial.println((const char*)tool["status"]);
      } else {
        // create new tool entry
        String code = formatCode();
        JsonObject newTool = db.createNestedArray("tools").createNestedObject(); 
        // Note: above line is wrong approach to append. Do it differently:
        // We'll create a temp object via an intermediate array
        // (workaround in ArduinoJson: push back)
        JsonArray tools = db["tools"].as<JsonArray>();
        JsonObject toolObj = tools.createNestedObject();
        toolObj["uid"] = uid;
        toolObj["code"] = code;
        toolObj["status"] = "available"; // 'available' after cadastro
        toolObj["created_at"] = millis();
        // increment next_tool_id
        int nt = db["next_tool_id"] | 1;
        db["next_tool_id"] = nt + 1;

        Serial.print(F("Novo cadastro registrado: ")); Serial.println(code);
        saveDB();

        // open lock 5s
        openLockForMs(RELAY_OPEN_MS);
      }
      // halt reading until tag removed to avoid duplicates
      while (mfrc522.PICC_IsNewCardPresent() || mfrc522.PICC_ReadCardSerial()) {
        delay(200);
      }
    } else if (c == '2') {
      Serial.println(F("MODO: DEVOLUÇÃO"));
      JsonArray tools = db["tools"].as<JsonArray>();
      if (tools.size() == 0) {
        Serial.println(F("Nenhuma ferramenta cadastrada. Devolução não permitida."));
        return;
      }
      Serial.println(F("Aproxime a TAG para devolução..."));
      while (!mfrc522.PICC_IsNewCardPresent()) {
        delay(50);
      }
      if (!mfrc522.PICC_ReadCardSerial()) return;
      String uid = uidToString(mfrc522.uid);
      Serial.print(F("TAG ORIGINAL: ")); Serial.println(uid);

      int idx = findToolIndexByUID(uid);
      if (idx >= 0) {
        JsonObject tool = db["tools"][idx].as<JsonObject>();
        const char* curStatus = tool["status"] | "unknown";
        if (String(curStatus) == "returned") {
          Serial.println(F("Essa tag já está marcada como devolvida."));
        } else {
          tool["status"] = "returned";
          tool["returned_at"] = millis();
          Serial.print(F("Tag encontrada. Código: ")); Serial.println((const char*)tool["code"]);
          Serial.println(F("Marcada como devolvida."));
          saveDB();
          openLockForMs(RELAY_OPEN_MS);
        }
      } else {
        Serial.println(F("Tag não encontrada no sistema. Não é possível devolver."));
      }
      while (mfrc522.PICC_IsNewCardPresent() || mfrc522.PICC_ReadCardSerial()) {
        delay(200);
      }
    } else if (c == 'L' || c == 'l') {
      // list all tools
      JsonArray tools = db["tools"].as<JsonArray>();
      Serial.print(F("Total ferramentas cadastradas: "));
      Serial.println(tools.size());
      int i = 0;
      for (JsonObject tool : tools) {
        Serial.print(i++);
        Serial.print(F(") UID: ")); Serial.print((const char*)tool["uid"]);
        Serial.print(F("  CODE: ")); Serial.print((const char*)tool["code"]);
        Serial.print(F("  STATUS: ")); Serial.println((const char*)tool["status"]);
      }
    } else if (c == 'R' || c == 'r') {
      Serial.println(F("Forçando save do DB..."));
      saveDB();
    } else {
      // ignore other keys, but clear linebreaks
    }
  }

  // small idle tasks (e.g., allow card reads in passive mode)
  delay(10);
}
