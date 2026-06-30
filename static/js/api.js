async function loadModels() {
    try {
        const response = await fetch('/api/models');
        const data = await response.json();
        if (data.success && data.models.length && App.els.modelBadge) {
            const gemmaModel = data.models.find((model) => model.toLowerCase().includes('gemma4')) || data.models[0];
            App.els.modelBadge.textContent = gemmaModel;
        }
    } catch (error) {
        console.error(error);
    }
}
