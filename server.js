const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

// Update MongoDB configuration to use local path:
const PORT = 3001;
const MONGO_PORT = 27018;  // Using alternate port
const MONGO_URL = `mongodb://127.0.0.1:${MONGO_PORT}`;
const DB_NAME = 'ticket_exchange';
const DB_PATH = path.join(__dirname, 'data/db');
const UPLOAD_FOLDER = path.join(__dirname, 'uploads');

// Create required directories
const fs = require('fs');
if (!fs.existsSync(UPLOAD_FOLDER)) {
    fs.mkdirSync(UPLOAD_FOLDER);
}
if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(DB_PATH, { recursive: true });
}

const client = new MongoClient(MONGO_URL);

const isDev = process.env.NODE_ENV !== 'production';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOAD_FOLDER));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_FOLDER),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

let usersCol, ticketsCol;

async function initDb() {
    try {
        await client.connect();
        console.log('Connected to MongoDB on port', MONGO_PORT);
        const db = client.db(DB_NAME);
        usersCol = db.collection('users');
        ticketsCol = db.collection('tickets');
        
        // Create indexes
        await usersCol.createIndex({ username: 1 }, { unique: true });
        await ticketsCol.createIndex({ id: 1 }, { unique: true });
        
        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Database initialization error:', error);
        console.log('Make sure MongoDB is running on port', MONGO_PORT);
        process.exit(1);
    }
}
initDb();

// --- Auth ---
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
    const exists = await usersCol.findOne({ username });
    if (exists) return res.status(400).json({ error: 'Username exists' });
    await usersCol.insertOne({ username, password, balance: 1000 });
    res.json({ success: true });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await usersCol.findOne({ username });
    if (!user || user.password !== password) return res.status(400).json({ error: 'Invalid credentials' });
    res.json({ username, balance: user.balance });
});

app.get('/api/balance', async (req, res) => {
    const username = req.header('X-Username');
    const user = await usersCol.findOne({ username });
    res.json({ balance: user ? user.balance : 0 });
});

app.post('/api/topup', upload.none(), async (req, res) => {
    const username = req.header('X-Username');
    const amount = parseInt(req.body.amount, 10);
    if (!username || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid request' });
    await usersCol.updateOne({ username }, { $inc: { balance: amount } });
    const user = await usersCol.findOne({ username });
    res.json({ balance: user.balance });
});

// --- Tickets ---
app.get('/api/tickets', async (req, res) => {
    const tickets = await ticketsCol.find({ resale: true }).project({ _id: 0 }).toArray();
    res.json(tickets);
});

app.get('/api/mytickets', async (req, res) => {
    const username = req.header('X-Username');
    // Show all tickets owned by the user (including resale tickets)
    const tickets = await ticketsCol.find({ owner: username })
        .project({
            _id: 0,
            type: 1,
            event: 1,
            date: 1,
            price: 1,
            image: 1,
            owner: 1,
            created_at: 1,
            resale: 1,
            sold: 1,
            id: 1
        })
        .toArray();

    // Ensure boolean values
    const formattedTickets = tickets.map(ticket => ({
        ...ticket,
        resale: Boolean(ticket.resale),
        sold: Boolean(ticket.sold)
    }));

    res.json(formattedTickets);
});

app.post('/api/tickets', upload.single('image'), async (req, res) => {
    const username = req.header('X-Username');
    const { type, event, date, price } = req.body;
    let image_url = '';
    if (req.file) image_url = '/uploads/' + req.file.filename;
    if (!type || !event || !date || !price) return res.status(400).json({ error: 'Missing required fields' });

    // Ensure owner exists
    const ownerUser = await usersCol.findOne({ username });
    if (!ownerUser) {
        return res.status(400).json({ error: 'Invalid owner. Please log in again.' });
    }

    const ticket = {
        id: Date.now().toString(),
        type,
        event,
        date,
        price: parseInt(price, 10),
        image: image_url,
        owner: username,
        created_at: new Date().toISOString(),
        resale: true
    };

    try {
        await ticketsCol.insertOne(ticket);
        res.json({ success: true });
    } catch (error) {
        console.error('Ticket creation error:', error);
        res.status(500).json({ error: 'Failed to create ticket' });
    }
});

app.post('/api/tickets/resale', upload.none(), async (req, res) => {
    try {
        const username = req.header('X-Username');
        const { ticket_id, price } = req.body;
        const newPrice = parseInt(price, 10);

        // Find the original ticket with stricter conditions
        const ticket = await ticketsCol.findOne({
            id: ticket_id,
            owner: username,
            resale: false,
            sold: false
        });

        if (!ticket) {
            return res.status(404).json({
                error: 'Ticket not found or not available for resale'
            });
        }

        // Always check against the very first original price in the chain
        let originalPrice = ticket.price;
        if (ticket.original_price) {
            originalPrice = ticket.original_price;
        }
        if (ticket.original_owner) {
            let ancestor = ticket;
            while (ancestor.original_price && ancestor.original_owner) {
                originalPrice = ancestor.original_price;
                ancestor = await ticketsCol.findOne({
                    owner: ancestor.original_owner,
                    event: ancestor.event,
                    date: ancestor.date,
                    type: ancestor.type,
                    price: ancestor.original_price
                });
                if (!ancestor) break;
            }
        }

        if (newPrice > originalPrice) {
            return res.status(400).json({
                error: `Resale price (${newPrice}) cannot exceed original price (${originalPrice})`
            });
        }

        if (newPrice <= 0) {
            return res.status(400).json({
                error: 'Price must be greater than 0'
            });
        }

        // --- REMOVE TRANSACTION/SESSION LOGIC FOR STANDALONE MONGODB ---
        // Instead, perform the operations sequentially

        // Delete the original ticket (move, not replicate)
        const deleteResult = await ticketsCol.deleteOne({
            id: ticket_id,
            owner: username,
            resale: false,
            sold: false
        });

        if (deleteResult.deletedCount === 0) {
            return res.status(400).json({ error: 'Ticket already listed, sold, or not found' });
        }

        // Double-check: Remove any duplicate owned tickets (edge case cleanup)
        await ticketsCol.deleteMany({
            id: ticket_id,
            owner: username,
            resale: false
        });

        // Create new resale ticket (move, not replicate)
        const resaleTicket = {
            ...ticket,
            id: ticket_id, // <--- keep the same id to "move" the ticket
            price: newPrice,
            resale: true,
            original_price: originalPrice,
            original_owner: ticket.original_owner || ticket.owner,
            created_at: new Date().toISOString()
        };
        delete resaleTicket._id;

        await ticketsCol.insertOne(resaleTicket);

        res.json({
            success: true,
            message: 'Ticket listed for resale successfully'
        });
    } catch (error) {
        console.error('Resale error:', error);
        res.status(500).json({
            error: error.message || 'Failed to list ticket for resale'
        });
    }
});

app.post('/api/tickets/buy', upload.none(), async (req, res) => {
    try {
        const username = req.header('X-Username');
        const { ticket_id } = req.body;
        
        if (!username || !ticket_id) {
            return res.status(400).json({ error: 'Missing username or ticket ID' });
        }

        // Find the ticket
        const ticket = await ticketsCol.findOne({ id: ticket_id, resale: true });
        if (!ticket) {
            return res.status(404).json({ error: 'Ticket not found or not available for sale' });
        }

        // Check if buyer is not the owner
        if (ticket.owner === username) {
            return res.status(400).json({ error: 'Cannot purchase your own ticket' });
        }

        // Get buyer and seller details
        const buyer = await usersCol.findOne({ username: username });
        const seller = await usersCol.findOne({ username: ticket.owner });
        
        if (!buyer) {
            return res.status(400).json({ error: 'Invalid buyer. Please log in again.' });
        }
        if (!seller) {
            return res.status(400).json({ error: 'Invalid seller for this ticket.' });
        }

        const price = parseInt(ticket.price, 10);
        
        // Check buyer's balance
        if (buyer.balance < price) {
            return res.status(400).json({ error: 'Insufficient balance' });
        }

        // Perform the transaction
        await usersCol.updateOne(
            { username }, 
            { $inc: { balance: -price } }
        );
        
        await usersCol.updateOne(
            { username: ticket.owner }, 
            { $inc: { balance: price } }
        );

        // Mark original ticket as sold
        await ticketsCol.updateOne(
            { id: ticket_id },
            { $set: { sold: true, resale: false } }
        );

        // Create new ticket for buyer
        const newTicket = {
            ...ticket,
            id: Date.now().toString(),
            owner: username,
            resale: false,
            sold: false,
            previous_owner: ticket.owner,
            purchase_date: new Date().toISOString()
        };
        delete newTicket._id;
        
        await ticketsCol.insertOne(newTicket);

        res.json({ 
            success: true,
            message: 'Ticket purchased successfully',
            ticket: newTicket
        });
        
    } catch (error) {
        console.error('Purchase error:', error);
        res.status(500).json({ 
            error: 'Failed to process purchase',
            details: error.message 
        });
    }
});

// Delete a ticket by ID
app.delete('/api/tickets/:ticket_id', async (req, res) => {
    try {
        const username = req.header('X-Username');
        const ticket_id = req.params.ticket_id;

        console.log('Delete request:', { username, ticket_id }); // Debug log

        if (!username || !ticket_id) {
            return res.status(400).json({ error: 'Invalid request parameters' });
        }

        // Try to find ticket by MongoDB _id first
        let ticket;
        try {
            ticket = await ticketsCol.findOne({
                owner: username,
                _id: new ObjectId(ticket_id)
            });
        } catch (e) {
            ticket = await ticketsCol.findOne({
                owner: username,
                $or: [
                    { id: ticket_id },
                    { created_at: ticket_id }
                ]
            });
        }

        console.log('Found ticket:', ticket); // Debug log

        if (!ticket) {
            return res.status(404).json({ 
                error: 'Ticket not found',
                debug: { searchedId: ticket_id }
            });
        }

        // Delete using the _id from found ticket
        const result = await ticketsCol.deleteOne({
            _id: ticket._id,
            owner: username
        });

        // Also, if the ticket is a resale ticket, remove any ticket with the same id and resale: true
        if (ticket.resale === true && ticket.id) {
            await ticketsCol.deleteMany({ id: ticket.id, resale: true });
        }

        if (result.deletedCount === 0) {
            throw new Error('Failed to delete ticket');
        }

        res.json({ 
            success: true,
            message: 'Ticket deleted successfully',
            ticketId: ticket_id
        });

    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ 
            error: error.message || 'Server error while deleting ticket',
            ticketId: req.params.ticket_id
        });
    }
});

// Update a ticket by ID
app.put('/api/tickets/:ticket_id', async (req, res) => {
    try {
        const username = req.header('X-Username');
        const ticket_id = req.params.ticket_id;
        const { type, event, date, price } = req.body;

        if (!username || !ticket_id || !type || !event || !date || !price) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Try to update the ticket in-place
        const updateResult = await ticketsCol.updateOne(
            { id: ticket_id, owner: username, sold: false },
            { $set: { 
                type, 
                event, 
                date, 
                price: parseInt(price, 10),
                updated_at: new Date().toISOString()
            }}
        );

        if (updateResult.matchedCount > 0) {
            // Updated in-place, done
            return res.json({ success: true });
        }

        // If not found, try to find the ticket (maybe it's in a state not matching sold: false)
        const oldTicket = await ticketsCol.findOne({ id: ticket_id, owner: username });
        if (oldTicket) {
            // Delete the old ticket first to avoid duplicate key error
            await ticketsCol.deleteOne({ id: ticket_id, owner: username });

            // Create new ticket with same id and updated fields
            const newTicket = {
                ...oldTicket,
                type,
                event,
                date,
                price: parseInt(price, 10),
                updated_at: new Date().toISOString()
            };
            delete newTicket._id;
            await ticketsCol.insertOne(newTicket);

            return res.json({ success: true });
        }

        // If not found at all
        return res.status(404).json({ error: 'Ticket not found or not available for editing' });
    } catch (error) {
        res.status(500).json({ 
            error: error.message || 'Failed to update ticket' 
        });
    }
});

// --- Static files ---
app.use(express.static(__dirname));

// Serve static files from the React app
app.use(express.static(path.join(__dirname)));

// The "catchall" handler: for any request that doesn't
// match one above, send back the index.html file.
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ 
        error: 'Internal server error', 
        details: err.message 
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
