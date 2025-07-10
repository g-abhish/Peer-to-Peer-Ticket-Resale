# Peer-to-Peer-Ticket-Resale
A ticket exchange web app with user authentication, ticket resale (with price limits), balance management, and image uploads. Built using Node.js, Express, MongoDB, and Multer. Includes a setup script for automatic MongoDB and server startup on macOS/Linux.

# Ticket Exchange System

A web-based ticket marketplace where users can buy, sell and resell tickets.

## Prerequisites

- Node.js (v14 or higher)
- MongoDB (v6.0 or higher)
- Git

## Setup & Run Instructions

1. Clone the repository:
```bash
git clone <repository-url>
cd abhi
```

2. Make the run script executable:
```bash
chmod +x run.sh
```

3. Run the script (this will install dependencies, create required directories, and start both servers):
```bash
./run.sh
```

This will:
- Start MongoDB on port 27018
- Start the Node.js server on port 3001
- Create required directories (data/db and uploads) if they do not exist

4. Access the application:
- Open your browser and go to: http://localhost:3001

## Features

- User authentication (register/login)
- List tickets for sale
- Buy tickets
- Resell tickets
- Track ticket ownership
- View transaction history
- Balance management

## Default User Balance

New users start with 1000 coins balance.

## Stopping the Servers

To stop both MongoDB and Node.js servers:
- Press Ctrl+C in the terminal where `run.sh` is running

## Troubleshooting

1. If MongoDB fails to start:
   - Check if port 27018 is free
   - Ensure you have write permissions for the data/db directory

2. If Node.js server fails:
   - Check if port 3001 is available
   - Ensure all dependencies are installed

3. For permission issues:
   ```bash
   sudo chown -R $USER:$USER data/db
   sudo chown -R $USER:$USER uploads
   ```

## Directory Structure

```
abhi/
├── data/
│   └── db/           # MongoDB data directory
├── uploads/          # Ticket images storage
├── server.js         # Backend server
├── index.html        # Frontend
├── run.sh            # Setup and run script
└── README.md         # This file
```
