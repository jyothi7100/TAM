sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], (Controller, JSONModel, MessageToast, MessageBox) => {
    "use strict";

    return Controller.extend("project1.controller.View1", {
        onInit() {
            this.getView().setModel(new JSONModel({ rows: [], fileName: "", results: [] }), "materialModel");
            this.getView().setModel(new JSONModel({ rows: [], fileName: "", results: [] }), "serviceModel");
        },

        onTabSelect: function () {
            // no-op for now; each tab keeps its own independent state
        },

        // ===================== MATERIAL TAB =====================

        onUploadPressMaterial: function () {
            var oFileUploader = this.byId("excelUploaderMaterial");
            var oInput = oFileUploader.$().find("input[type=file]")[0];
            if (oInput) { oInput.click(); }
        },

        onRemoveFileMaterial: function () {
            this._resetModel("materialModel");
            this.byId("excelUploaderMaterial").clear();
        },

        onFileChangeMaterial: function (oEvent) {
            this._handleFileChange(oEvent, "materialModel", "material");
        },

        onCheckDuplicatesMaterial: function () {
            this._checkDuplicates("materialModel");
        },

        onDownloadPressMaterial: function () {
            this._download("materialModel");
        },

        // ===================== SERVICES TAB =====================

        onUploadPressService: function () {
            var oFileUploader = this.byId("excelUploaderService");
            var oInput = oFileUploader.$().find("input[type=file]")[0];
            if (oInput) { oInput.click(); }
        },

        onRemoveFileService: function () {
            this._resetModel("serviceModel");
            this.byId("excelUploaderService").clear();
        },

        onFileChangeService: function (oEvent) {
            this._handleFileChange(oEvent, "serviceModel", "service");
        },

        onCheckDuplicatesService: function () {
            this._checkDuplicates("serviceModel");
        },

        onDownloadPressService: function () {
            this._download("serviceModel");
        },

        // ===================== SHARED LOGIC =====================

        _resetModel: function (sModelName) {
            var oModel = this.getView().getModel(sModelName);
            oModel.setProperty("/rows", []);
            oModel.setProperty("/fileName", "");
            oModel.setProperty("/results", []);
        },

        _handleFileChange: function (oEvent, sModelName, sType) {
            var aFiles = oEvent.getParameter("files");
            var oFile = aFiles && aFiles[0];
            var oModel = this.getView().getModel(sModelName);

            if (!oFile) {
                this._resetModel(sModelName);
                return;
            }

            if (typeof XLSX === "undefined") {
                MessageToast.show("Still loading Excel library, please try again in a moment");
                return;
            }

            var that = this;
            oModel.setProperty("/fileName", oFile.name);

            var oReader = new FileReader();

            oReader.onload = function (e) {
                var data = new Uint8Array(e.target.result);
                var workbook = XLSX.read(data, { type: "array" });

                var sheetName = workbook.SheetNames.includes("Bulk creation template")
                    ? "Bulk creation template"
                    : workbook.SheetNames[0];

                var aJson = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

                var aRows;

                if (sType === "material") {
                    // Material: requires a Manufacturer Part Number; that's the search value
                    aRows = aJson
                        .filter(function (row) {
                            return row["Manufacturer Part Number"];
                        })
                        .map(function (row, idx) {
                            var sShortText = String(row["Short Text (EN)"] ?? "").trim();
                            var sMpn = String(row["Manufacturer Part Number"] ?? "").trim();
                            return {
                                rowNo: idx + 1,
                                status: "Pending",
                                shortText: sShortText,
                                searchValue: sMpn,
                                materialDescription: sShortText,
                                originalRow: row
                            };
                        });
                } else {
                    // Services: no MPN column - Short Text itself is the search value
                    aRows = aJson
                        .filter(function (row) {
                            return row["Short Text (EN)"];
                        })
                        .map(function (row, idx) {
                            var sShortText = String(row["Short Text (EN)"] ?? "").trim();
                            return {
                                rowNo: idx + 1,
                                status: "Pending",
                                shortText: sShortText,
                                searchValue: sShortText,
                                materialDescription: sShortText,
                                originalRow: row
                            };
                        });
                }

                oModel.setProperty("/rows", aRows);
                oModel.setProperty("/results", []);
                MessageToast.show(aRows.length + " records loaded");
            };

            oReader.onerror = function () {
                MessageBox.error("Could not read the file");
            };

            oReader.readAsArrayBuffer(oFile);
        },

        _checkDuplicates: function (sModelName) {
            var oModel = this.getView().getModel(sModelName);
            var aRows = oModel.getProperty("/rows");

            if (!aRows || aRows.length === 0) {
                MessageToast.show("Please upload a file first");
                return;
            }

            this._callDuplicateCheckAPI(aRows, sModelName);
        },

        _callDuplicateCheckAPI: function (aRows, sModelName) {
            var that = this;
            var oModel = this.getView().getModel(sModelName);
            this.getView().setBusy(true);

            var aPayloadRows = aRows.map(function (row) {
                return {
                    rowNo: row.rowNo,
                    materialNumber: row.searchValue,
                    materialDescription: row.shortText
                };
            });

            fetch("/odata/v4/duplicate/$metadata", {
                method: "GET",
                headers: { "X-CSRF-Token": "Fetch" }
            })
            .then(function (tokenRes) {
                var csrfToken = tokenRes.headers.get("X-CSRF-Token");

                return fetch("/odata/v4/duplicate/checkDuplicates", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-CSRF-Token": csrfToken || ""
                    },
                    body: JSON.stringify({ records: aPayloadRows })
                });
            })
            .then(function (res) {
                if (!res.ok) { throw new Error("API returned " + res.status); }
                return res.json();
            })
            .then(function (apiResult) {
                that.getView().setBusy(false);

                var aResultRows = apiResult.value || apiResult;
                var lastRowNo = null;

                var aResults = aResultRows.map(function (item) {
                    var bIsDuplicate = item.status === 'Duplicate';
                    var bIsFirstOfGroup = item.rowNo !== lastRowNo;
                    lastRowNo = item.rowNo;

                    return {
                        groupKey: item.rowNo,
                        rowNo: bIsFirstOfGroup ? item.rowNo : "",
                        materialDesc: bIsFirstOfGroup ? item.materialDesc : "",
                        searchValue: bIsFirstOfGroup ? item.mpn : "",
                        status: bIsFirstOfGroup ? item.status : "",
                        matchedMaterialNo: item.matchedMaterialNo || "",
                        matchedMaterialDesc: item.matchedMaterialDesc || "",
                        matchedLongDesc: item.matchedLongDesc || "",
                        selected: !bIsDuplicate,
                        showCheckbox: bIsFirstOfGroup
                    };
                });

                oModel.setProperty("/results", aResults);
            })
            .catch(function (err) {
                that.getView().setBusy(false);
                MessageBox.error("Error checking duplicates: " + err.message);
            });
        },

        _download: function (sModelName) {
            var oModel = this.getView().getModel(sModelName);
            var aOriginalRows = oModel.getProperty("/rows");
            var aResults = oModel.getProperty("/results");

            if (!aOriginalRows || aOriginalRows.length === 0) {
                MessageToast.show("No data to download");
                return;
            }

            var oCheckedDuplicateRowNos = {};
            if (aResults && aResults.length > 0) {
                aResults.forEach(function (row) {
                    if (row.showCheckbox && row.selected && row.status === 'Duplicate') {
                        oCheckedDuplicateRowNos[row.groupKey] = true;
                    }
                });
            }

            var aRowsToExport = aOriginalRows.filter(function (row) {
                return !oCheckedDuplicateRowNos[row.rowNo];
            });

            if (aRowsToExport.length === 0) {
                MessageToast.show("All records were marked as duplicates - nothing to download");
                return;
            }

            var aExportData = aRowsToExport.map(function (row) {
                return row.originalRow;
            });

            var ws = XLSX.utils.json_to_sheet(aExportData);
            var wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Records");
            XLSX.writeFile(wb, "clean_upload_list.xlsx");
        }
    });
});