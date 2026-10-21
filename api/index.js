'use strict';

// Punto de entrada para Vercel: todas las rutas se reescriben a esta función.
const { getApp } = require('../src/bootstrap');

module.exports = async (req, res) => {
  try {
    const { app } = await getApp();
    return app(req, res);
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('El servicio no está configurado correctamente. Revisá las variables de entorno y los registros.');
  }
};
