<?php
// api_action.php
// Recebe: uid, acao (retirar|devolver), codigo (opcional), borrower_name (opcional), borrower_class (opcional), user_id (opcional)

// resposta como texto para o Arduino interpretar (ok / erro: ...)
header("Content-Type: text/plain");
include __DIR__ . '/../conexao.php'; // ajuste se colocar conexao.php em outro local

// Parâmetros
$uid = isset($_GET['uid']) ? trim($_GET['uid']) : '';
$acao = isset($_GET['acao']) ? trim($_GET['acao']) : '';
$codigo = isset($_GET['codigo']) ? trim($_GET['codigo']) : null;
$borrower_name = isset($_GET['borrower_name']) ? trim($_GET['borrower_name']) : null;
$borrower_class = isset($_GET['borrower_class']) ? trim($_GET['borrower_class']) : null;
$user_id = isset($_GET['user_id']) ? intval($_GET['user_id']) : null;

// Validações básicas
if ($uid === '' || ($acao !== 'retirar' && $acao !== 'devolver')) {
    http_response_code(400);
    echo "erro: parametros invalidos";
    exit;
}

try {
    // Normaliza UID (opcional)
    $uid = strtoupper($uid);

    // 1) Verifica se a ferramenta existe (na sua imagem a tabela é "tools")
    $stmt = $conn->prepare("SELECT * FROM tools WHERE uid = :uid LIMIT 1");
    $stmt->execute([':uid' => $uid]);
    $tool = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$tool) {
        // Cria ferramenta placeholder (nome e categoria podem ser atualizados depois pelo painel)
        $defaultName = $codigo ? $codigo : ("Tool " . $uid);
        $defaultCategory = null;
        $insert = $conn->prepare("INSERT INTO tools (uid, name, category, status) VALUES (:uid, :name, :category, :status)");
        $insert->execute([
            ':uid' => $uid,
            ':name' => $defaultName,
            ':category' => $defaultCategory,
            ':status' => 'disponivel'
        ]);
        $tool_id = $conn->lastInsertId();
    } else {
        $tool_id = $tool['id'];
    }

    // 2) Atualiza status e insere log
    if ($acao === 'retirar') {
        // atualiza tools.status para 'em_uso'
        $upd = $conn->prepare("UPDATE tools SET status = :status WHERE id = :id");
        $upd->execute([':status' => 'em_uso', ':id' => $tool_id]);

        // inserir log (tabela logs: tool_id, user_id, action, borrower_name, borrower_class, timestamp)
        $ins = $conn->prepare("INSERT INTO logs (tool_id, user_id, action, borrower_name, borrower_class, timestamp) VALUES (:tool_id, :user_id, :action, :borrower_name, :borrower_class, :timestamp)");
        $ins->execute([
            ':tool_id' => $tool_id,
            ':user_id' => $user_id ? $user_id : null,
            ':action' => 'retirada',
            ':borrower_name' => $borrower_name,
            ':borrower_class' => $borrower_class,
            ':timestamp' => date('Y-m-d H:i:s')
        ]);

        echo "ok";
        exit;
    }

    if ($acao === 'devolver') {
        // atualiza tools.status para 'disponivel'
        $upd = $conn->prepare("UPDATE tools SET status = :status WHERE id = :id");
        $upd->execute([':status' => 'disponivel', ':id' => $tool_id]);

        // inserir log
        $ins = $conn->prepare("INSERT INTO logs (tool_id, user_id, action, borrower_name, borrower_class, timestamp) VALUES (:tool_id, :user_id, :action, :borrower_name, :borrower_class, :timestamp)");
        $ins->execute([
            ':tool_id' => $tool_id,
            ':user_id' => $user_id ? $user_id : null,
            ':action' => 'devolucao',
            ':borrower_name' => $borrower_name,
            ':borrower_class' => $borrower_class,
            ':timestamp' => date('Y-m-d H:i:s')
        ]);

        echo "ok";
        exit;
    }

    // se chegou aqui, ação inválida
    echo "erro: acao invalida";
    exit;

} catch (Exception $e) {
    http_response_code(500);
    // em dev você pode ver a mensagem, em produção envie uma mensagem genérica
    echo "erro: " . $e->getMessage();
    exit;
}
?>

