sap.ui.define([
    "sap/ui/core/UIComponent",
    "project1/model/models"
], (UIComponent, models) => {
    "use strict";

    return UIComponent.extend("project1.Component", {
        metadata: {
            manifest: "json",
            interfaces: [
                "sap.ui.core.IAsyncContentCreation"
            ]
        },

        init() {
            // load XLSX library before anything else needs it
            this._loadXLSX();

            // call the base component's init function
            UIComponent.prototype.init.apply(this, arguments);

            // set the device model
            this.setModel(models.createDeviceModel(), "device");

            // enable routing
            this.getRouter().initialize();
        },

        _loadXLSX() {
            if (window.XLSX) {
                return;
            }
            const script = document.createElement("script");
            script.src = sap.ui.require.toUrl("project1/thirdparty/xlsx.full.min.js");
            document.head.appendChild(script);
        }
    });
});