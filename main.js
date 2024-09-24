const express = require("express");
const app = express();
const {performHandshakes, getConfigFromRepo} = require("./utils");
app.use(express.json());

// Handshake webhook endpoint
app.post('/handshake', async (req, res) => {
    try {
        const { url } = req.body;

        const {contract, service, interface} = await getConfigFromRepo(url);
        const actualState = await performHandshakes(service, contract, interface)
        res.status(200).json(actualState);
    } catch (error) {
        console.error('Error during handshake:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
