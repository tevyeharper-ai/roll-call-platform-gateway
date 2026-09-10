<?php
require dirname(__DIR__).'/src/helpers.php';

$url = getenv('DATABASE_URL') ?: '';
if ($url === '') {
    fwrite(STDOUT, "Forge Railway init: DATABASE_URL is not configured yet; starting without PostgreSQL initialization.\n");
    exit(0);
}

try {
    $pdo = forge_pdo($url);
    $before = (bool)$pdo->query("SELECT to_regclass('public.agencies') IS NOT NULL")->fetchColumn();
    $ran = run_postgres_migrations($url);
    if (!$before) {
        seed_postgres_from_json($url);
        fwrite(STDOUT, "Forge Railway init: PostgreSQL migrated and initial Forge registry seeded.\n");
    } else {
        fwrite(STDOUT, "Forge Railway init: PostgreSQL migrations verified.\n");
    }
    fwrite(STDOUT, "Forge Railway init: ".count($ran)." migration file(s) applied/verified.\n");
} catch (Throwable $e) {
    fwrite(STDERR, "Forge Railway init failed: ".$e->getMessage()."\n");
    exit(1);
}
