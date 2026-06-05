#!/usr/bin/env bash
# packablock-demo: Fully Automated End-to-End (E2E) Cryptographic Integration Test Runner
# Verifies the full chain lifecycle between pkablk client and Fastify trust registry across both Standard and Premium tiers.


set -eo pipefail

BOLD='\033[1m'
GREEN='\033[32m'
CYAN='\033[36m'
YELLOW='\033[33m'
RED='\033[31m'
RESET='\033[0m'

echo -e "${BOLD}${CYAN}============================================================${RESET}"
echo -e "${BOLD}${CYAN}🚀 Starting Packablock End-to-End (E2E) Integration Tests...${RESET}"
echo -e "${BOLD}${CYAN}============================================================${RESET}\n"

# Define workspace variables
CLIENT_BIN="../packablock-client/index.ts"
REGISTRY_DIR="../packablock-registry"
PORT=3030
SERVER_URL="http://localhost:${PORT}"
OWNER="demouser"

# Clean up any leftover artifacts from previous runs
rm -f packablock.yaml packablock.yaml.bak pack.tar.gz
rm -rf extract-test temp-verify-dir

# Determine if the registry server is already running on port 3030
SERVER_RUNNING=true
if ! curl -s --connect-timeout 2 "${SERVER_URL}/api/v1/log/pull" >/dev/null 2>&1; then
  SERVER_RUNNING=false
  echo -e "${YELLOW}⚠️  Registry server not detected on port ${PORT}. Starting a temporary instance...${RESET}"
  
  # Start registry in background with GITHUB API MOCKING enabled
  cd "${REGISTRY_DIR}"
  DATABASE_FILE="packablock_e2e_temp.sqlite" PORT=${PORT} MOCK_GITHUB_API=true bun start >/dev/null 2>&1 &
  REGISTRY_PID=$!
  cd - >/dev/null
  
  # Wait for registry server to boot up
  echo -n "Waiting for registry to boot"
  for i in {1..30}; do
    if curl -s --connect-timeout 2 "${SERVER_URL}/api/v1/log/pull" >/dev/null 2>&1; then
      echo -e " ${GREEN}Ready!${RESET}"
      break
    fi
    echo -n "."
    sleep 0.5
  done
  
  if ! curl -s --connect-timeout 2 "${SERVER_URL}/api/v1/log/pull" >/dev/null 2>&1; then
    echo -e "\n${RED}❌ Error: Failed to start temporary registry server.${RESET}"
    exit 1
  fi
fi

# Define cleanup trap
cleanup() {
  echo -e "\n${BOLD}${CYAN}🧹 Cleaning up local temporary files...${RESET}"
  rm -f packablock.yaml packablock.yaml.bak pack.tar.gz
  rm -rf extract-test temp-verify-dir
  
  if [ "$SERVER_RUNNING" = false ] && [ -n "$REGISTRY_PID" ]; then
    echo -e "${YELLOW}Stopping temporary registry server (PID: ${REGISTRY_PID})...${RESET}"
    kill -9 "$REGISTRY_PID" || true
    rm -f "${REGISTRY_DIR}/packablock_e2e_temp.sqlite"
  fi
  echo -e "${GREEN}Done!${RESET}"
}
trap cleanup EXIT

# -----------------------------------------------------------------------------
# Reusable Lifecycle Execution Flow Function
# -----------------------------------------------------------------------------
run_e2e_flow() {
  local token="$1"
  local owner="$2"
  local repo="$3"
  local label="$4"
  local repo_path="${owner}/${repo}"

  echo -e "${BOLD}${CYAN}------------------------------------------------------------${RESET}"
  echo -e "${BOLD}${CYAN}💎 Running E2E Lifecycle Flow for: ${label} (${repo_path})${RESET}"
  echo -e "${BOLD}${CYAN}------------------------------------------------------------${RESET}"

  # Clean up any leftover artifacts from previous runs
  rm -f packablock.yaml packablock.yaml.bak pack.tar.gz

  # 1. Initialize Local Chain Ledger
  echo -e "${BOLD}* Initializing new package log ledger...${RESET}"
  bun run "$CLIENT_BIN" init packablock.yaml -d "message: \"Initial E2E genesis block for ${label}\""
  echo -e "${GREEN}✅ Genesis block created successfully!${RESET}\n"

  # 2. Append Dependency Update Block
  echo -e "${BOLD}* Appending dependency changes to local ledger...${RESET}"
  bun run "$CLIENT_BIN" append packablock.yaml -d "packages:
  lodash: 4.17.21
  yaml: 2.9.0"
  echo -e "${GREEN}✅ Block appended successfully!${RESET}\n"

  # 3. Run Standalone (Offline) Integrity Verification Check
  echo -e "${BOLD}* Running Standalone offline verification check...${RESET}"
  bun run "$CLIENT_BIN" check packablock.yaml
  echo -e "${GREEN}✅ Local Standalone verification passed successfully!${RESET}\n"

  # 4. Push Verified Ledger Chain to Registry
  echo -e "${BOLD}* Pushing local ledger chain to the registry server...${RESET}"
  bun run "$CLIENT_BIN" push packablock.yaml -s "$SERVER_URL" -t "$token"
  echo -e "${GREEN}✅ Ledger chain pushed and synchronized with registry!${RESET}\n"

  # 5. Run Registry-Anchored Integrity Verification Check
  echo -e "${BOLD}* Running registry-anchored verification check...${RESET}"
  bun run "$CLIENT_BIN" check packablock.yaml -s "$SERVER_URL" -t "$token" -r "$repo_path"
  echo -e "${GREEN}✅ Registry-anchored verification passed!${RESET}\n"

  # 6. Compile Verified Pack Metadata Archive
  echo -e "${BOLD}* Compiling metadata-only Pack tarball...${RESET}"
  bun run "$CLIENT_BIN" pack -o pack.tar.gz -l packablock.yaml
  echo -e "${GREEN}✅ Pack tarball 'pack.tar.gz' compiled successfully!${RESET}\n"

  # 7. Verify the Pack Tarball directly
  echo -e "${BOLD}* Verifying the compiled 'pack.tar.gz' archive...${RESET}"
  bun run "$CLIENT_BIN" check pack.tar.gz -s "$SERVER_URL" -t "$token" -r "$repo_path"
  echo -e "${GREEN}✅ Pack archive verification passed successfully!${RESET}\n"

  # 8. Perform Cryptographic Key Rollover & Archiving
  echo -e "${BOLD}* Performing key rollover boundary rotation and sync...${RESET}"
  bun run "$CLIENT_BIN" rollover packablock.yaml -s "$SERVER_URL" -t "$token" -r "$repo_path"
  echo -e "${GREEN}✅ Local & registry rollover completed and old ledger archived!${RESET}\n"

  # 9. Query & Assert Cold Archived History
  echo -e "${BOLD}* Fetching cold archived epochs from the registry...${RESET}"
  local archive_res
  archive_res=$(curl -s "${SERVER_URL}/api/v1/repo/${owner}/${repo}/archive")
  echo -e "${CYAN}Archive response:${RESET}"
  echo "$archive_res" | jq .

  local archive_count
  archive_count=$(echo "$archive_res" | jq '.archives | length')
  if [ "$archive_count" -ne 1 ]; then
    echo -e "${RED}❌ E2E Failure: Expected 1 archived log epoch, but found ${archive_count}.${RESET}"
    exit 1
  fi
  echo -e "${GREEN}✅ Cold archive verification passed for ${label}!${RESET}\n"
}

# -----------------------------------------------------------------------------
# 1. Standard Registry Access Level (Unverified flow)
# -----------------------------------------------------------------------------
echo -e "${BOLD}${YELLOW}===> Testing Standard Registry Access Level (Unverified Flow) <===${RESET}\n"

echo -e "${BOLD}1. Registering standard repository 'demouser/demo-repo-standard' on registry...${RESET}"
REGISTER_PAYLOAD=$(jq -n --arg owner "$OWNER" --arg repo "demo-repo-standard" '{owner: $owner, repo: $repo, isPremium: false}')
REGISTER_RES=$(curl -s -X POST -H "Content-Type: application/json" -d "$REGISTER_PAYLOAD" "${SERVER_URL}/api/v1/acme/new-account")

REG_TOKEN_STANDARD=$(echo "$REGISTER_RES" | jq -r '.registrationToken')

if [ -z "$REG_TOKEN_STANDARD" ] || [ "$REG_TOKEN_STANDARD" = "null" ]; then
  echo -e "${RED}❌ Failed to register standard repository. Response: ${REGISTER_RES}${RESET}"
  exit 1
fi
echo -e "${GREEN}✅ Standard repository registered successfully! Token: ${REG_TOKEN_STANDARD:0:12}...${RESET}\n"

run_e2e_flow "$REG_TOKEN_STANDARD" "$OWNER" "demo-repo-standard" "Standard Tier"

# -----------------------------------------------------------------------------
# 2. Premium Registry Access Level (ACME-verified flow)
# -----------------------------------------------------------------------------
echo -e "\n${BOLD}${YELLOW}===> Testing Premium Registry Access Level (ACME-verified Flow) <===${RESET}\n"

echo -e "${BOLD}1. Initiating Premium registration for 'demouser/demo-repo-premium'...${RESET}"
PREMIUM_REGISTER_PAYLOAD=$(jq -n --arg owner "$OWNER" --arg repo "demo-repo-premium" '{owner: $owner, repo: $repo, isPremium: true}')
PREMIUM_REGISTER_RES=$(curl -s -X POST -H "Content-Type: application/json" -d "$PREMIUM_REGISTER_PAYLOAD" "${SERVER_URL}/api/v1/acme/new-account")

CHALLENGE_NONCE=$(echo "$PREMIUM_REGISTER_RES" | jq -r '.challengeNonce')
PENDING_STATUS=$(echo "$PREMIUM_REGISTER_RES" | jq -r '.verificationStatus')

if [ -z "$CHALLENGE_NONCE" ] || [ "$CHALLENGE_NONCE" = "null" ]; then
  echo -e "${RED}❌ Failed to initiate premium registration. Response: ${PREMIUM_REGISTER_RES}${RESET}"
  exit 1
fi
echo -e "${GREEN}✅ Premium registration initiated! Nonce: ${CHALLENGE_NONCE}${RESET}"
echo -e "${GREEN}✅ Verification Status is: ${PENDING_STATUS}${RESET}\n"

# 2. Assert Zero-Trust Access Policy is active
echo -e "${BOLD}2. Asserting Zero-Trust Access Control (temporary pending token should be rejected)...${RESET}"
# Generate a fresh local chain
rm -f packablock.yaml
bun run "$CLIENT_BIN" init packablock.yaml -d "message: \"Genesis for pending premium check\"" >/dev/null 2>&1
PUSH_RES=$(bun run "$CLIENT_BIN" push packablock.yaml -s "$SERVER_URL" -t "pb_reg_forgedtoken12345" 2>&1 || true)
if [[ "$PUSH_RES" == *"failed"* || "$PUSH_RES" == *"Forbidden"* || "$PUSH_RES" == *"Unauthorized"* || "$PUSH_RES" == *"400"* || "$PUSH_RES" == *"401"* || "$PUSH_RES" == *"403"* ]]; then
  echo -e "${GREEN}✅ Zero-Trust access control validated! Push with forged/unverified token successfully blocked.${RESET}\n"
else
  echo -e "${RED}❌ Security Vulnerability: Registry accepted push without active registration token! Response: ${PUSH_RES}${RESET}"
  exit 1
fi

# 3. Complete ACME verification challenge loop
echo -e "${BOLD}3. Completing ACME verification challenge loop for 'demouser/demo-repo-premium'...${RESET}"
VERIFY_PAYLOAD=$(jq -n --arg owner "$OWNER" --arg repo "demo-repo-premium" '{owner: $owner, repo: $repo, verificationType: "github-api"}')
VERIFY_RES=$(curl -s -X POST -H "Content-Type: application/json" -d "$VERIFY_PAYLOAD" "${SERVER_URL}/api/v1/acme/verify")

REG_TOKEN_PREMIUM=$(echo "$VERIFY_RES" | jq -r '.registrationToken')
VERIFICATION_STATUS=$(echo "$VERIFY_RES" | jq -r '.verificationStatus')

if [ -z "$REG_TOKEN_PREMIUM" ] || [ "$REG_TOKEN_PREMIUM" = "null" ] || [ "$VERIFICATION_STATUS" != "verified" ]; then
  echo -e "${RED}❌ Premium verification failed. Response: ${VERIFY_RES}${RESET}"
  exit 1
fi
echo -e "${GREEN}✅ Premium repository verified successfully! Status: ${VERIFICATION_STATUS}${RESET}"
echo -e "${GREEN}✅ Active Premium Registration Token issued: ${REG_TOKEN_PREMIUM:0:12}...${RESET}\n"

# 4. Run the full lifecycle for premium verified repo
run_e2e_flow "$REG_TOKEN_PREMIUM" "$OWNER" "demo-repo-premium" "Premium Tier"

echo -e "\n${BOLD}${GREEN}============================================================${RESET}"
echo -e "${BOLD}${GREEN}🎉 SUCCESS! All E2E cryptographic validation checks passed!${RESET}"
echo -e "${BOLD}${GREEN}============================================================${RESET}"
