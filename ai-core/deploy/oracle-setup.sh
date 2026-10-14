#!/usr/bin/env bash
# Oracle Cloud 무료 VM (Ubuntu) 에서 한 번 실행:  bash deploy/oracle-setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

# Oracle Ubuntu 이미지는 기본 방화벽이 80/443 을 막는다 → 열기
if command -v iptables >/dev/null; then
  for port in 80 443; do
    sudo iptables -C INPUT -p tcp --dport $port -j ACCEPT 2>/dev/null || \
      sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport $port -j ACCEPT
  done
  sudo apt-get install -y iptables-persistent >/dev/null 2>&1 || true
  sudo netfilter-persistent save >/dev/null 2>&1 || true
fi

[ -f .env ] || { cp .env.example .env; echo ".env 를 만들었습니다. 값을 채운 뒤 다시 실행하세요:  nano .env"; exit 0; }
mkdir -p data && sudo chown 1000:1000 data

PROFILES=""
grep -q '^LOCAL_LLM_URL=' .env && PROFILES="$PROFILES --profile local-brain"
grep -q '^DOMAIN=.\+' .env && PROFILES="$PROFILES --profile https"
sudo docker compose $PROFILES up -d --build
echo "실행됨. 로그 보기:  sudo docker compose logs -f core"
