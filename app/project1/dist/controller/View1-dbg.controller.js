sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], (Controller, JSONModel, MessageToast, MessageBox) => {
    "use strict";

    return Controller.extend("project1.controller.View1", {
        onInit() {
            this.getView().setModel(new JSONModel({ rows: [], fileName: "" }), "uploadModel");
            this.getView().setModel(new JSONModel({ results: [] }), "resultModel");
        },

        onUploadPress: function () {
            var oFileUploader = this.byId("excelUploader");
            var oInput = oFileUploader.$().find("input[type=file]")[0];
            if (oInput) {
                oInput.click();
            }
        },

        onRemoveFile: function () {
            this.getView().getModel("uploadModel").setProperty("/rows", []);
            this.getView().getModel("uploadModel").setProperty("/fileName", "");
            this.getView().getModel("resultModel").setProperty("/results", []);
            this.byId("excelUploader").clear();
        },

        onFileChange: function (oEvent) {
    var aFiles = oEvent.getParameter("files");
    var oFile = aFiles && aFiles[0];

    if (!oFile) {
        this.getView().getModel("uploadModel").setProperty("/rows", []);
        this.getView().getModel("uploadModel").setProperty("/fileName", "");
        this.getView().getModel("resultModel").setProperty("/results", []);
        return;
    }

    if (typeof XLSX === "undefined") {
        MessageToast.show("Still loading Excel library, please try again in a moment");
        return;
    }

    var that = this;
    this.getView().getModel("uploadModel").setProperty("/fileName", oFile.name);

    var oReader = new FileReader();

    oReader.onload = function (e) {
        var data = new Uint8Array(e.target.result);
        var workbook = XLSX.read(data, { type: "array" });

        var sheetName = workbook.SheetNames.includes("Bulk creation template")
            ? "Bulk creation template"
            : workbook.SheetNames[0];

        var aJson = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

        var aRows = aJson
            .filter(function (row) {
                return row["Manufacturer Part Number"];
            })
            .map(function (row, idx) {
                return {
                    rowNo: idx + 1,
                    status: "Pending",
                    shortText: String(row["Short Text (EN)"] ?? "").trim(),
                    mpn: String(row["Manufacturer Part Number"] ?? "").trim(),
                    materialDescription: String(row["Short Text (EN)"] ?? "").trim(),
                    originalRow: row  // keep the ENTIRE original row (all 34+ columns) for download
                };
            });

        that.getView().getModel("uploadModel").setProperty("/rows", aRows);
        that.getView().getModel("resultModel").setProperty("/results", []);
        MessageToast.show(aRows.length + " records loaded");
    };

    oReader.onerror = function () {
        MessageBox.error("Could not read the file");
    };

    oReader.readAsArrayBuffer(oFile);
},
        onCheckDuplicates: function () {
            var aRows = this.getView().getModel("uploadModel").getProperty("/rows");

            if (!aRows || aRows.length === 0) {
                MessageToast.show("Please upload a file first");
                return;
            }

            this._callDuplicateCheckAPI(aRows);
        },

    _callDuplicateCheckAPI: function (aRows) {
    var that = this;
    this.getView().setBusy(true);

    var aPayloadRows = aRows.map(function (row) {
        return {
            rowNo: row.rowNo,
            materialNumber: row.mpn,
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
                mpn: bIsFirstOfGroup ? item.mpn : "",
                status: bIsFirstOfGroup ? item.status : "",
                matchedMaterialNo: item.matchedMaterialNo || "",
                matchedMaterialDesc: item.matchedMaterialDesc || "",
                matchedLongDesc: item.matchedLongDesc || "",
                selected: !bIsDuplicate,
                showCheckbox: bIsFirstOfGroup
            };
        });
        that.getView().getModel("resultModel").setProperty("/results", aResults);
    })
    .catch(function (err) {
        that.getView().setBusy(false);
        MessageBox.error("Error checking duplicates: " + err.message);
    });
},
        onDownloadPress: function () {
    var aOriginalRows = this.getView().getModel("uploadModel").getProperty("/rows");
    var aResults = this.getView().getModel("resultModel").getProperty("/results");

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

    // Export the full original row exactly as uploaded (all columns), not just our derived fields
    var aExportData = aRowsToExport.map(function (row) {
        return row.originalRow;
    });

    var ws = XLSX.utils.json_to_sheet(aExportData);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Records");
    XLSX.writeFile(wb, "clean_upload_list.xlsx");
},
    });
});