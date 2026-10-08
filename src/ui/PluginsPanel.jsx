import React, { useEffect, useState } from 'react';
import { pluginEngine } from '../core/PluginEngine.js';

export default function PluginsPanel({ onClose, onRunPluginResult }) {
  const [plugins, setPlugins] = useState([]);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [paramValues, setParamValues] = useState({});
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState('');

  const loadPlugins = async (force = false) => {
    setLoadingCatalog(true);
    setCatalogError('');
    try {
      await pluginEngine.loadCatalog({ force });
      const all = pluginEngine.getAllPlugins();
      setPlugins(all);
      if (all.length > 0 && !selected) selectPlugin(all[0]);
      if (all.length === 0) setCatalogError(pluginEngine.loadError || 'Le catalogue de plugins est vide.');
    } catch (error) {
      setCatalogError(error.message || 'Impossible de charger les plugins.');
    } finally {
      setLoadingCatalog(false);
    }
  };

  useEffect(() => {
    loadPlugins();
  }, []);

  const selectPlugin = (p) => {
    setSelected(p);
    const defaults = {};
    for (const param of p.parameters || []) {
      defaults[param.name] = param.default || '';
    }
    setParamValues(defaults);
    setOutput('');
  };

  const handleExecute = async (e) => {
    if (e) e.preventDefault();
    if (!selected) return;
    setRunning(true);
    setOutput('Exécution du plugin en cours...');
    try {
      const res = await pluginEngine.runPlugin(selected, paramValues);
      setOutput(res);
      onRunPluginResult?.(selected, res);
    } catch (err) {
      setOutput(`Erreur : ${err.message || err}`);
    } finally {
      setRunning(false);
    }
  };

  const filtered = plugins.filter((p) => {
    const q = filter.toLowerCase().trim();
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      (p.title || '').toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="prod-panel">
      <div className="space-header">
        <div className="space-tabs">
          <span className="space-tab active">
            🧩 Catalogue de Plugins ({loadingCatalog ? 'chargement…' : `${plugins.length} disponibles`})
          </span>
        </div>
        <div className="space-header-right">
          <button className="space-mini-btn" onClick={() => loadPlugins(true)} disabled={loadingCatalog} title="Recharger les plugins">
            {loadingCatalog ? '⏳' : '↻'} Actualiser
          </button>
          {onClose && (
            <button className="space-close-btn" onClick={onClose}>
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="prod-body">
        {catalogError && (
          <div className="space-card plugin-catalog-error">
            <strong>Catalogue indisponible</strong>
            <span>{catalogError}</span>
            <span>Vérifiez que les fichiers de <code>assets/plugins</code> sont installés dans l’application.</span>
          </div>
        )}
        <div className="plugins-layout">
          {/* Left column: Searchable list of 82 plugins */}
          <div className="plugins-sidebar">
            <input
              type="text"
              className="plugins-search"
              placeholder="Filtrer les 82 plugins (ex: sncf, nasa, crypto, wiki, cinéma, météo)..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <div className="plugins-list">
              {filtered.map((p) => (
                <button
                  key={p.name}
                  className={`plugin-row-btn ${selected?.name === p.name ? 'active' : ''}`}
                  onClick={() => selectPlugin(p)}
                >
                  <div className="plugin-row-title">{p.title || p.name}</div>
                  <div className="plugin-row-name">{p.name}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Right column: Selected plugin details & runner */}
          <div className="plugins-detail">
            {selected ? (
              <div className="space-card">
                <div className="plugin-head-row">
                  <div>
                    <h3>{selected.title || selected.name}</h3>
                    <span className="space-badge">ID: {selected.name} • Type: {selected.type || 'http'}</span>
                  </div>
                  <button className="media-play-btn" onClick={handleExecute} disabled={running}>
                    {running ? '⏳ Exécution...' : '▶ Exécuter maintenant'}
                  </button>
                </div>

                <p className="plugin-desc">{selected.description}</p>

                {(selected.parameters || []).length > 0 && (
                  <form className="plugin-params-form" onSubmit={handleExecute}>
                    <h4>Paramètres</h4>
                    {selected.parameters.map((param) => (
                      <div key={param.name} className="plugin-param-field">
                        <label>
                          <strong>{param.name}</strong>
                          {param.required ? ' *' : ''} — <span>{param.description}</span>
                        </label>
                        <input
                          type="text"
                          value={paramValues[param.name] || ''}
                          onChange={(e) =>
                            setParamValues({ ...paramValues, [param.name]: e.target.value })
                          }
                          placeholder={param.default || param.name}
                        />
                      </div>
                    ))}
                  </form>
                )}

                {selected.url && (
                  <div className="plugin-endpoint">
                    Endpoint : <code>{selected.url}</code>
                  </div>
                )}

                {output && (
                  <div className="plugin-output-box">
                    <h4>Résultat en direct</h4>
                    <pre>{output}</pre>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-card">Sélectionnez un plugin dans la liste.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
