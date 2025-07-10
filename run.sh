#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[1;36m'
NC='\033[0m' # No Color

# Define the MongoDB port
MONGO_PORT=27018

echo -e "${GREEN}Starting setup...${NC}"

# Determine OS type
OS_TYPE=""
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS_TYPE="mac"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS_TYPE="linux"
fi

# Function to kill processes on a given port
kill_process_on_port() {
    local port=$1
    echo -e "${YELLOW}Checking for processes on port $port...${NC}"
    local pids_to_kill=""

    if [[ "$OS_TYPE" == "mac" ]]; then
        # For macOS, use lsof to get PIDs, filter out header and extraneous output
        pids_to_kill=$(sudo lsof -ti :"$port" 2>/dev/null)
    elif [[ "$OS_TYPE" == "linux" ]]; then
        # For Linux, use netstat and awk
        pids_to_kill=$(sudo netstat -tulnp | grep ":$port " | awk '{print $7}' | cut -d'/' -f1 2>/dev/null)
    fi

    if [ -n "$pids_to_kill" ]; then
        # Iterate over each PID and kill it
        for PID in $pids_to_kill; do
            echo -e "${RED}Found process on port $port (PID: $PID). Killing...${NC}"
            # Try graceful kill first, then forceful
            kill "$PID" 2>/dev/null
            sleep 1
            if ps -p "$PID" > /dev/null; then
                echo -e "${RED}Process $PID still running. Forcing kill...${NC}"
                kill -9 "$PID" 2>/dev/null
            fi
        done
        sleep 2 # Give it a moment for all processes to terminate
        echo -e "${GREEN}All identified processes on port $port terminated.${NC}"
    else
        echo -e "${GREEN}No processes found on port $port.${NC}"
    fi
}


# Check if MongoDB is installed
if ! command -v mongod &> /dev/null; then
    echo -e "${RED}MongoDB not found. Installing MongoDB...${NC}"
    if [[ "$OS_TYPE" == "mac" ]]; then
        brew tap mongodb/brew
        brew install mongodb-community
    elif [[ "$OS_TYPE" == "linux" ]]; then
        # Ensure curl is installed for fetching PGP key
        if ! command -v curl &> /dev/null; then
            echo -e "${YELLOW}curl not found. Installing curl...${NC}"
            sudo apt-get update && sudo apt-get install -y curl
        fi
        curl -fsSL https://www.mongodb.org/static/pgp/server-6.0.asc | \
           sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/mongodb-org-6.0.gpg
        echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu $(lsb_release -cs)/mongodb-org/6.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list
        sudo apt-get update
        sudo apt-get install -y mongodb-org
    else
        echo -e "${RED}Unsupported OS for automatic MongoDB installation. Please install MongoDB manually.${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}MongoDB already installed${NC}"
fi

# Install Node.js dependencies
echo -e "${GREEN}Installing Node.js dependencies...${NC}"
npm install express cors multer mongodb

# --- MongoDB Data Directory Update ---
# Create data directory for MongoDB in the user's home directory
echo -e "${GREEN}Creating MongoDB data directory...${NC}"
MONGO_DATA_PATH="$HOME/mongodb_data" # Define a path in your home directory
mkdir -p "$MONGO_DATA_PATH"
mkdir -p uploads

# Set permissions for the data directory
# Note: For personal development, 777 is often used for simplicity,
# but for production environments, stricter permissions are recommended.
chmod -R 777 "$MONGO_DATA_PATH"
chmod -R 777 uploads

echo -e "${GREEN}Setup complete! Starting servers...${NC}"

# Kill any process on the MongoDB port before starting
kill_process_on_port "$MONGO_PORT"

# Start MongoDB in background using the new data path
echo "Starting MongoDB on port $MONGO_PORT with dbpath: $MONGO_DATA_PATH..."
mongod --dbpath="$MONGO_DATA_PATH" --port "$MONGO_PORT" &
MONGO_PID=$!

# Wait for MongoDB to start
echo -e "${YELLOW}Waiting for MongoDB to initialize (3 seconds)...${NC}"
sleep 3

# Check if MongoDB started successfully
if ! ps -p "$MONGO_PID" > /dev/null; then
    echo -e "${RED}Failed to start MongoDB. Please check MongoDB logs for errors.${NC}"
    exit 1
else
    echo -e "${GREEN}MongoDB started successfully.${NC}"
fi

echo "Starting Node.js server..."
node server.js &
NODE_PID=$!

# Add visible URL message
echo -e "\n${YELLOW}================================${NC}"
echo -e "${CYAN}Server is running at: http://localhost:3001${NC}"
echo -e "${YELLOW}================================${NC}\n"

# Handle shutdown
function cleanup() {
    echo -e "\n${YELLOW}Shutting down servers...${NC}"
    # Check if MONGO_PID and NODE_PID are valid before killing
    if ps -p $MONGO_PID > /dev/null 2>&1; then
        kill $MONGO_PID 2>/dev/null # Gracefully kill MongoDB
    fi
    if ps -p $NODE_PID > /dev/null 2>&1; then
        kill $NODE_PID 2>/dev/null # Gracefully kill Node.js server
    fi
    # Wait for processes to terminate
    sleep 2
    echo -e "${GREEN}Servers shut down.${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM

# Keep script running
wait