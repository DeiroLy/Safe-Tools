<?php


$db_path = __DIR__ . '/../ferramentas.db';
if (!file_exists($db_path)) {
    // alternativa: pasta data
    $db_path = __DIR__ . '/../data/ferramentas.db';
}


try {
    // PDO sqlite
    $conn = new PDO('sqlite:' . $db_path);
    $conn->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    // Foreign keys ON
    $conn->exec('PRAGMA foreign_keys = ON;');
} catch (Exception $e) {
    // Em produção evite expor detalhes
    http_response_code(500);
    echo "DB_CONNECTION_ERROR: " . $e->getMessage();
    exit;
}
?>
