const express = require('express');
const app = express();

// Configuración para Vercel
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Storage en memoria
let registros = [];
let contador = 1001;

// CORS para Vercel
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    service: 'Sistema de Créditos Académicos',
    platform: 'Vercel',
    timestamp: new Date().toISOString(),
    registros: registros.length
  });
});

// Página principal
app.get('/', (req, res) => {
  const totalCreditos = registros.reduce((sum, r) => sum + r.creditos, 0).toFixed(2);
  const totalHoras = registros.reduce((sum, r) => sum + r.horas, 0);

  res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sistema de Créditos Académicos</title>
    <meta name="description" content="Sistema de registro de créditos académicos para el Colegio de Psicólogos de Guatemala">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
            line-height: 1.6;
        }
        
        .container { 
            max-width: 900px; 
            margin: 0 auto; 
            background: rgba(255, 255, 255, 0.98);
            border-radius: 20px;
            box-shadow: 0 25px 50px rgba(0, 0, 0, 0.15);
            overflow: hidden;
            backdrop-filter: blur(20px);
        }
        
        .header {
            background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
            color: white;
            padding: 50px 40px;
            text-align: center;
            position: relative;
        }
        
        .header::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grain" width="100" height="100" patternUnits="userSpaceOnUse"><circle cx="25" cy="25" r="1" fill="rgba(255,255,255,0.1)"/><circle cx="75" cy="75" r="1" fill="rgba(255,255,255,0.1)"/><circle cx="50" cy="10" r="1" fill="rgba(255,255,255,0.1)"/></pattern></defs><rect width="100" height="100" fill="url(%23grain)"/></svg>');
            opacity: 0.3;
            pointer-events: none;
        }
        
        .header h1 { 
            font-size: 2.8em;
            margin-bottom: 15px;
            font-weight: 300;
            position: relative;
            z-index: 1;
        }
        
        .header p {
            font-size: 1.3em;
            opacity: 0.9;
            position: relative;
            z-index: 1;
        }
        
        .main-content {
            padding: 50px 40px;
        }
        
        .status { 
            background: linear-gradient(135deg, #27ae60, #2ecc71);
            color: white; 
            padding: 30px; 
            border-radius: 15px; 
            text-align: center; 
            margin-bottom: 40px;
            box-shadow: 0 15px 35px rgba(39, 174, 96, 0.3);
            position: relative;
            overflow: hidden;
        }
        
        .status::before {
            content: '';
            position: absolute;
            top: -50%;
            left: -50%;
            width: 200%;
            height: 200%;
            background: linear-gradient(45deg, transparent 40%, rgba(255,255,255,0.1) 50%, transparent 60%);
            animation: shine 3s infinite;
        }
        
        @keyframes shine {
            0% { transform: translateX(-100%) translateY(-100%); }
            100% { transform: translateX(100%) translateY(100%); }
        }
        
        .form-section {
            background: white;
            padding: 40px;
            border-radius: 20px;
            margin-bottom: 40px;
            box-shadow: 0 15px 35px rgba(0, 0, 0, 0.1);
            border: 1px solid rgba(0, 0, 0, 0.05);
        }
        
        .section-title {
            color: #2c3e50;
            font-size: 2em;
            margin-bottom: 30px;
            padding-bottom: 15px;
            border-bottom: 3px solid #3498db;
            display: inline-block;
            position: relative;
        }
        
        .section-title::after {
            content: '';
            position: absolute;
            bottom: -3px;
            left: 0;
            width: 50%;
            height: 3px;
            background: linear-gradient(90deg, #e74c3c, #f39c12);
            border-radius: 3px;
        }
        
        .form-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
            gap: 25px;
            margin-bottom: 25px;
        }
        
        .form-group { 
            margin-bottom: 25px; 
        }
        
        label { 
            display: block; 
            margin-bottom: 10px; 
            font-weight: 600;
            color: #2c3e50;
            font-size: 1em;
        }
        
        input, select { 
            width: 100%; 
            padding: 18px 20px; 
            border: 2px solid #e8ecf4; 
            border-radius: 12px; 
            font-size: 16px;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            background: #fafbfc;
            font-family: inherit;
        }
        
        input:focus, select:focus { 
            outline: none; 
            border-color: #3498db; 
            background: white;
            box-shadow: 0 0 0 4px rgba(52, 152, 219, 0.1);
            transform: translateY(-2px);
        }
        
        input::placeholder {
            color: #95a5a6;
        }
        
        button { 
            background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
            color: white; 
            padding: 20px 40px; 
            border: none; 
            border-radius: 12px; 
            cursor: pointer; 
            width: 100%; 
            font-size: 1.2em;
            font-weight: 600;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            overflow: hidden;
        }
        
        button::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
            transition: left 0.5s;
        }
        
        button:hover::before {
            left: 100%;
        }
        
        button:hover { 
            transform: translateY(-3px); 
            box-shadow: 0 15px 35px rgba(52, 152, 219, 0.4);
        }
        
        button:disabled {
            opacity: 0.7;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
        }
        
        .credits-display { 
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
            padding: 30px; 
            margin: 30px 0; 
            border-left: 6px solid #28a745; 
            border-radius: 15px;
            position: relative;
        }
        
        .credits-display::before {
            content: '📊';
            position: absolute;
            top: -10px;
            left: 20px;
            font-size: 2em;
            background: white;
            padding: 5px;
            border-radius: 50%;
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        }
        
        .credits-display h4 {
            color: #2c3e50;
            margin-bottom: 15px;
            font-size: 1.3em;
            margin-top: 10px;
        }
        
        .credits-number {
            font-size: 2.2em;
            font-weight: bold;
            color: #28a745;
            margin: 20px 0;
            text-shadow: 0 2px 4px rgba(40, 167, 69, 0.3);
        }
        
        .result { 
            margin: 30px 0; 
            padding: 30px; 
            border-radius: 15px; 
            text-align: center;
            animation: slideIn 0.6s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
        }
        
        .success { 
            background: linear-gradient(135deg, #d4edda, #c3e6cb);
            color: #155724; 
            border: 2px solid #c3e6cb;
        }
        
        .error { 
            background: linear-gradient(135deg, #f8d7da, #f1b0b7);
            color: #721c24; 
            border: 2px solid #f1b0b7;
        }
        
        .stats-container {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 25px;
            margin: 40px 0;
        }
        
        .stat-card {
            background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
            color: white;
            padding: 30px;
            border-radius: 20px;
            text-align: center;
            box-shadow: 0 15px 35px rgba(52, 152, 219, 0.3);
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            overflow: hidden;
        }
        
        .stat-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(45deg, transparent 40%, rgba(255,255,255,0.1) 50%, transparent 60%);
            transform: translateX(-100%);
            transition: transform 0.6s;
        }
        
        .stat-card:hover::before {
            transform: translateX(100%);
        }
        
        .stat-card:hover {
            transform: translateY(-8px);
        }
        
        .stat-number {
            font-size: 3em;
            font-weight: bold;
            margin-bottom: 10px;
            text-shadow: 0 3px 6px rgba(0,0,0,0.2);
        }
        
        @keyframes slideIn {
            from { 
                opacity: 0; 
                transform: translateY(30px) scale(0.95); 
            }
            to { 
                opacity: 1; 
                transform: translateY(0) scale(1); 
            }
        }
        
        .loading-spinner {
            display: inline-block;
            animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .correlativo-code {
            background: rgba(0,0,0,0.1); 
            padding: 8px 15px; 
            border-radius: 8px;
            font-family: 'Courier New', monospace;
            font-weight: bold;
            font-size: 1.1em;
            letter-spacing: 1px;
        }
        
        @media (max-width: 768px) {
            .container {
                margin: 10px;
                border-radius: 15px;
            }
            
            .header {
                padding: 30px 25px;
            }
            
            .header h1 {
                font-size: 2.2em;
            }
            
            .main-content {
                padding: 30px 25px;
            }
            
            .form-section {
                padding: 25px;
            }
            
            .form-grid {
                grid-template-columns: 1fr;
                gap: 20px;
            }
            
            .stats-container {
                grid-template-columns: 1fr;
                gap: 20px;
            }
        }
        
        @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after {
                animation-duration: 0.01ms !important;
                animation-iteration-count: 1 !important;
                transition-duration: 0.01ms !important;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎓 Sistema de Créditos Académicos</h1>
            <p>Colegio de Psicólogos de Guatemala</p>
        </div>

        <div class="main-content">
            <div class="status">
                ✅ <strong>Sistema funcionando perfectamente en Vercel</strong><br>
                <small>Plataforma estable y confiable | Total de registros: ${registros.length}</small>
            </div>

            <div class="form-section">
                <h2 class="section-title">Registro de Actividad Académica</h2>
                
                <form id="registroForm">
                    <div class="form-grid">
                        <div class="form-group">
                            <label for="nombre">Nombre Completo *</label>
                            <input type="text" id="nombre" placeholder="Ingrese su nombre completo" required>
                        </div>
                        
                        <div class="form-group">
                            <label for="telefono">Número de Teléfono Celular *</label>
                            <input type="tel" id="telefono" placeholder="Ej: 2234-5678 o 5555-1234" required>
                        </div>
                    </div>

                    <div class="form-grid">
                        <div class="form-group">
                            <label for="colegiado">Número de Colegiado *</label>
                            <input type="text" id="colegiado" placeholder="Número de colegiación" required>
                        </div>
                        
                        <div class="form-group">
                            <label for="estado">Estado de Colegiación *</label>
                            <select id="estado" required>
                                <option value="">Seleccione el estado</option>
                                <option value="Activo">Activo</option>
                                <option value="Inactivo">Inactivo</option>
                            </select>
                        </div>
                    </div>

                    <div class="form-group">
                        <label for="actividad">Nombre de la Actividad Científico-Académica *</label>
                        <input type="text" id="actividad" placeholder="Ej: Seminario de Psicología Clínica" required>
                    </div>

                    <div class="form-grid">
                        <div class="form-group">
                            <label for="horas">Horas de la Actividad *</label>
                            <input type="number" id="horas" min="0.5" max="1000" step="0.5" placeholder="Ej: 16" required>
                        </div>
                        
                        <div class="form-group">
                            <label for="fecha">Fecha de la Actividad *</label>
                            <input type="date" id="fecha" required>
                        </div>
                    </div>

                    <div class="credits-display">
                        <h4>Cálculo de Créditos Académicos</h4>
                        <p>Según el Artículo 16: Un crédito académico = 16 horas de educación</p>
                        <div class="credits-number" id="creditosCalculados">
                            Créditos: 0.00
                        </div>
                    </div>

                    <div class="form-group">
                        <label for="observaciones">Observaciones (Opcional)</label>
                        <input type="text" id="observaciones" placeholder="Comentarios adicionales" maxlength="500">
                    </div>

                    <button type="submit" id="btnSubmit">
                        🎓 Registrar Actividad Académica
                    </button>
                </form>
            </div>

            <div class="stats-container">
                <div class="stat-card">
                    <div class="stat-number" id="totalRegistros">${registros.length}</div>
                    <div>Total Registros</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" id="totalCreditos">${totalCreditos}</div>
                    <div>Total Créditos</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" id="totalHoras">${totalHoras}</div>
                    <div>Total Horas</div>
                </div>
            </div>

            <div id="resultado"></div>
        </div>
    </div>

    <script>
        // Configurar fechas
        const hoy = new Date();
        const fechaInput = document.getElementById('fecha');
        fechaInput.max = hoy.toISOString().split('T')[0];
        
        const hace5Anos = new Date();
        hace5Anos.setFullYear(hoy.getFullYear() - 5);
        fechaInput.min = hace5Anos.toISOString().split('T')[0];

        // Calcular créditos automáticamente
        document.getElementById('horas').addEventListener('input', function() {
            const horas = parseFloat(this.value) || 0;
            const creditos = (horas / 16).toFixed(2);
            document.getElementById('creditosCalculados').textContent = 'Créditos: ' + creditos;
        });

        // Manejar envío del formulario
        document.getElementById('registroForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const btnSubmit = document.getElementById('btnSubmit');
            const originalText = btnSubmit.innerHTML;
            
            btnSubmit.disabled = true;
            btnSubmit.innerHTML = '<span class="loading-spinner">⟳</span> Procesando...';
            
            const formData = {
                nombre: document.getElementById('nombre').value.trim(),
                telefono: document.getElementById('telefono').value.trim(),
                colegiado: document.getElementById('colegiado').value.trim(),
                estado: document.getElementById('estado').value,
                actividad: document.getElementById('actividad').value.trim(),
                horas: parseFloat(document.getElementById('horas').value),
                fecha: document.getElementById('fecha').value,
                observaciones: document.getElementById('observaciones').value.trim()
            };

            try {
                const response = await fetch('/api/registro', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(formData)
                });

                const result = await response.json();
                
                if (result.success) {
                    document.getElementById('resultado').innerHTML = 
                        '<div class="result success">' +
                        '<h3>✅ ¡Registro Exitoso!</h3>' +
                        '<p><strong>Correlativo asignado:</strong> <span class="correlativo-code">' + result.correlativo + '</span></p>' +
                        '<p><strong>Créditos obtenidos:</strong> ' + result.creditos + '</p>' +
                        '<p><strong>Fecha de registro:</strong> ' + new Date().toLocaleString('es-GT') + '</p>' +
                        '<small><em>💾 Conserve el número de correlativo para sus registros</em></small>' +
                        '</div>';
                    
                    // Limpiar formulario
                    this.reset();
                    document.getElementById('creditosCalculados').textContent = 'Créditos: 0.00';
                    
                    // Actualizar estadísticas
                    actualizarEstadisticas();
                    
                    // Scroll al resultado
                    document.getElementById('resultado').scrollIntoView({ 
                        behavior: 'smooth', 
                        block: 'center' 
                    });
                    
                } else {
                    document.getElementById('resultado').innerHTML = 
                        '<div class="result error">❌ <strong>Error:</strong> ' + (result.error || 'Error desconocido') + '</div>';
                }
                
            } catch (error) {
                document.getElementById('resultado').innerHTML = 
                    '<div class="result error">❌ <strong>Error de conexión:</strong> ' + error.message + '</div>';
            } finally {
                btnSubmit.disabled = false;
                btnSubmit.innerHTML = originalText;
            }
        });

        // Actualizar estadísticas
        async function actualizarEstadisticas() {
            try {
                const response = await fetch('/api/estadisticas');
                const stats = await response.json();
                
                document.getElementById('totalRegistros').textContent = stats.totalRegistros;
                document.getElementById('totalCreditos').textContent = stats.totalCreditos.toFixed(2);
                document.getElementById('totalHoras').textContent = stats.totalHoras;
            } catch (error) {
                console.log('Error al actualizar estadísticas:', error);
            }
        }

        // Cargar estadísticas al inicio
        actualizarEstadisticas();
        
        console.log('✅ Sistema de Créditos Académicos cargado correctamente en Vercel');
        
        // Mensaje de bienvenida en consola
        console.log('%c🎓 Sistema de Créditos Académicos', 'font-size: 20px; color: #3498db; font-weight: bold;');
        console.log('%cColegio de Psicólogos de Guatemala', 'font-size: 14px; color: #2c3e50;');
        console.log('%cSistema funcionando en Vercel', 'font-size: 12px; color: #27ae60;');
    </script>
</body>
</html>
  `);
});

// API para registro
app.post('/api/registro', (req, res) => {
  try {
    const { nombre, telefono, colegiado, estado, actividad, horas, fecha, observaciones } = req.body;
    
    // Validaciones
    if (!nombre || !telefono || !colegiado || !estado || !actividad || !horas || !fecha) {
      return res.status(400).json({ 
        success: false, 
        error: 'Todos los campos marcados con * son obligatorios' 
      });
    }

    if (isNaN(horas) || horas <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Las horas deben ser un número mayor a 0' 
      });
    }

    // Generar registro
    const correlativo = `CPG-${new Date().getFullYear()}-${String(contador++).padStart(4, '0')}`;
    const creditos = (parseFloat(horas) / 16).toFixed(2);
    
    const nuevoRegistro = {
      id: Date.now(),
      correlativo,
      nombre: nombre.trim(),
      telefono: telefono.trim(),
      colegiado: colegiado.trim(),
      estado,
      actividad: actividad.trim(),
      horas: parseFloat(horas),
      fecha,
      creditos: parseFloat(creditos),
      observaciones: observaciones || '',
      fechaRegistro: new Date().toISOString()
    };
    
    registros.push(nuevoRegistro);
    
    console.log('✅ Registro creado en Vercel:', correlativo);
    
    res.json({
      success: true,
      correlativo,
      creditos,
      mensaje: 'Actividad académica registrada exitosamente'
    });
    
  } catch (error) {
    console.error('❌ Error en registro:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error interno del servidor' 
    });
  }
});

// API para estadísticas
app.get('/api/estadisticas', (req, res) => {
  try {
    const totalRegistros = registros.length;
    const totalCreditos = registros.reduce((sum, r) => sum + r.creditos, 0);
    const totalHoras = registros.reduce((sum, r) => sum + r.horas, 0);
    
    res.json({
      totalRegistros,
      totalCreditos,
      totalHoras,
      ultimoRegistro: registros.length > 0 ? registros[registros.length - 1].correlativo : null
    });
  } catch (error) {
    console.error('Error en estadísticas:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// API para obtener todos los registros (para futura implementación admin)
app.get('/api/registros', (req, res) => {
  res.json({
    total: registros.length,
    registros: registros.slice(-10) // Solo los últimos 10 por seguridad
  });
});

// Manejo de errores
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    success: false, 
    error: 'Error interno del servidor' 
  });
});

// Para desarrollo local
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Servidor local iniciado en puerto ${PORT}`);
    console.log(`🌐 Abrir: http://localhost:${PORT}`);
  });
}

// Para Vercel, exportamos la app
module.exports = app;
