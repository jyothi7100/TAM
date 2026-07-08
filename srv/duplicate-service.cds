@open
@requires: 'any'
service DuplicateService {

    @requires: 'any'
    action checkDuplicates(records: array of {
        rowNo               : Integer;
        materialNumber      : String;
        materialDescription : String;
    }) returns array of {
        rowNo                : Integer;
        materialDesc         : String;
        mpn                  : String;
        status               : String;
        matchedMaterialNo    : String;
        matchedMaterialDesc  : String;
        matchedLongDesc      : String;
    };
}