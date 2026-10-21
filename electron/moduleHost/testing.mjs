// « #cornelius/testing » n'est utilisé que par les tests des modules, jamais à l'exécution dans Jarvis.
export function createTestModule() {
  throw new Error('Les tests des modules se lancent avec Cornelius (npm run test:modules), pas avec Jarvis.');
}
