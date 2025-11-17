<?php
// api/api_action.php
// Requer: PHP com PDO + SQLite habilitado
// Localização: repositorio (pasta root contains ferramentas.db), este arquivo em /api/
// DB path ajustado para um nível acima do diretório api

header('Content-Type: text/plain; charset=utf-8');

// caminho do arquivo sqlite (ajuste se necessário)
$dbFile = __DIR__ . '/../ferramentas.db';

try {
    $pdo = new PDO('sqlite:' . $dbFile);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (Exception $e) {
    http_response_code(500);
    echo "error: cannot open database - " . $e->getMessage();
    exit;
}

// Ler parâmetros
$uid_raw = isset($_GET['uid']) ? trim($_GET['uid']) : '';
$acao = isset($_GET['acao']) ? trim($_GET['acao']) : '';
$codigo = isset($_GET['codigo']) ? trim($_GET['codigo']) : null;
$usuario_id = isset($_GET['usuario_id']) ? intval($_GET['usuario_id']) : null;
$borrower_name = isset($_GET['borrower_name']) ? trim($_GET['borrower_name']) : null;
$borrower_class = isset($_GET['borrower_class']) ? trim($_GET['borrower_class']) : null;

if ($uid_raw === '' || !in_array($acao, ['retirar','devolver'])) {
    http_response_code(400);
    echo "error: missing or invalid parameters";
    exit;
}

// Normalize UID (upper, remove spaces)
$uid = strtoupper(preg_replace('/\s+/', '', $uid_raw));

try {
    $pdo->beginTransaction();

    // 1) busca ferramenta por UID
    $stmt = $pdo->prepare("SELECT id, name, category, status FROM tools WHERE uid = :uid LIMIT 1");
    $stmt->execute([':uid' => $uid]);
    $tool = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$tool) {
        // cria ferramenta placeholder (usa $codigo se fornecido)
        $name = $codigo ? $codigo : "Unknown - $uid";
        $category = null;
        $status_init = 'disponivel';
        $insert = $pdo->prepare("INSERT INTO tools (uid, name, category, status) VALUES (:uid, :name, :category, :status)");
        $insert->execute([
            ':uid' => $uid,
            ':name' => $name,
            ':category' => $category,
            ':status' => $status_init
        ]);
        $tool_id = $pdo->lastInsertId();
        $tool = ['id' => $tool_id, 'name' => $name, 'category' => $category, 'status' => $status_init];
    } else {
        $tool_id = $tool['id'];
    }

    // 2) atualizar status e inserir log conforme acao
    if ($acao === 'retirar') {
        // se já estiver em uso, ainda registramos mas retornamos aviso (a decisão é sua)
        $update = $pdo->prepare("UPDATE tools SET status = 'em_uso' WHERE id = :id");
        $update->execute([':id' => $tool_id]);

        $log = $pdo->prepare("INSERT INTO logs (tool_id, user_id, action, borrower_name, borrower_class, timestamp) VALUES (:tool_id, :user_id, :action, :bname, :bclass, :ts)");
        $log->execute([
            ':tool_id' => $tool_id,
            ':user_id' => $usuario_id ? $usuario_id : null,
            ':action' => 'retirada',
            ':bname' => $borrower_name ? $borrower_name : null,
            ':bclass' => $borrower_class ? $borrower_class : null,
            ':ts' => date('Y-m-d H:i:s')
        ]);

        $pdo->commit();
        echo "ok";
        exit;
    }

    if ($acao === 'devolver') {
        $update = $pdo->prepare("UPDATE tools SET status = 'disponivel' WHERE id = :id");
        $update->execute([':id' => $tool_id]);

        $log = $pdo->prepare("INSERT INTO logs (tool_id, user_id, action, borrower_name, borrower_class, timestamp) VALUES (:tool_id, :user_id, :action, :bname, :bclass, :ts)");
        $log->execute([
            ':tool_id' => $tool_id,
            ':user_id' => $usuario_id ? $usuario_id : null,
            ':action' => 'devolucao',
            ':bname' => $borrower_name ? $borrower_name : null,
            ':bclass' => $borrower_class ? $borrower_class : null,
            ':ts' => date('Y-m-d H:i:s')
        ]);

        $pdo->commit();
        echo "ok";
        exit;
    }

    // fallback
    $pdo->commit();
    echo "error: invalid action";
    exit;

} catch (Exception $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    http_response_code(500);
    echo "error: " . $e->getMessage();
    exit;
}

