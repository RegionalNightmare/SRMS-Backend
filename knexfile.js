require('dotenv').config();

const urlDB = `mysql://${process.env.MYQLUSER}:${process.env.MYQLPASSWORD}@${process.env.MYQLHOST}:${process.env.MYQLPORT}/${process.env.MYQLDATABASE}`;

const connection = mysql.createConnection(urlDB);


module.exports =  connection;
