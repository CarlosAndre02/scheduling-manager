#!/usr/bin/env bash
#
# Esvazia um bucket S3 versionado, incluindo objetos sob Object Lock GOVERNANCE.
# É o que `terraform destroy` não faz: ele só remove bucket já vazio.
#
#   ./purge-bucket.sh <bucket>          # conta o que apagaria, não apaga nada
#   ./purge-bucket.sh <bucket> --yes    # apaga
#
# DESTRUTIVO E IRREVERSÍVEL no modo --yes. Leia antes de rodar.
set -euo pipefail

BUCKET="${1:?uso: $0 <bucket> [--yes]}"
CONFIRM="${2:-}"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# --bypass-governance-retention exige s3:BypassGovernanceRetention, que
# AdministratorAccess concede — e só é aceito em bucket com Object Lock ligado.
# Passá-lo num bucket sem Object Lock não é ignorado: a chamada inteira falha com
# InvalidArgument. Por isso a flag é decidida por bucket, e não fixada no script.
#
# Em Object Lock modo COMPLIANCE nada disto funcionaria: lá nem o root apaga
# antes da data, e a única saída é fechar a conta.
BYPASS=()
if aws s3api get-object-lock-configuration --bucket "$BUCKET" >/dev/null 2>&1; then
  BYPASS=(--bypass-governance-retention)
fi

# A CLI pagina sozinha, e --max-keys é parâmetro do serviço: ele não impede a
# agregação de todas as páginas num JSON só. --max-items é o limite da CLI, e é
# o que mantém cada lote dentro do teto de 1000 chaves do delete-objects.
next_batch() { # $1 = Versions|DeleteMarkers -> escreve batch.json, ecoa a contagem
  aws s3api list-object-versions --bucket "$BUCKET" --max-items 1000 --output json \
    > "$TMP/page.json"
  python3 -c '
import json, sys
key, src, dst = sys.argv[1:4]
items = [{"Key": o["Key"], "VersionId": o["VersionId"]}
         for o in json.load(open(src)).get(key) or []]
json.dump({"Objects": items, "Quiet": True}, open(dst, "w"))
print(len(items))
' "$1" "$TMP/page.json" "$TMP/batch.json"
}

count_all() {
  aws s3api list-object-versions --bucket "$BUCKET" --output json > "$TMP/all.json"
  python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))
print(len(d.get("Versions") or []), len(d.get("DeleteMarkers") or []))
' "$TMP/all.json"
}

purge() { # $1 = Versions|DeleteMarkers
  local total=0 n
  while n=$(next_batch "$1"); [ "$n" -gt 0 ]; do
    aws s3api delete-objects --bucket "$BUCKET" \
      --delete "file://$TMP/batch.json" "${BYPASS[@]}" >/dev/null
    total=$((total + n))
    printf '\r  %-14s %d removidos' "$1" "$total"
  done
  [ "$total" -gt 0 ] && printf '\n'
  return 0
}

echo "bucket: $BUCKET"
[ ${#BYPASS[@]} -gt 0 ] && echo "  Object Lock ligado — a remoção usa bypass de governança"

if [ "$CONFIRM" != "--yes" ]; then
  read -r versions markers <<< "$(count_all)"
  echo "  versões:        $versions"
  echo "  delete markers: $markers"
  echo
  echo "Nada foi apagado. Repita com --yes para executar."
  exit 0
fi

purge Versions
purge DeleteMarkers
echo "vazio. 'terraform destroy' agora consegue remover o bucket."
