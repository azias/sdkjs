"use strict";

var asc = window["Asc"] ? window["Asc"] : (window["Asc"] = {});

var contentchanges_Add    = 1;
var contentchanges_Remove = 2;


function CContentChangesElement(Type, Pos, Count, Data)
{
    this.m_nType  = Type;  // Тип изменений (удаление или добавление)
    this.m_nPos   = Pos;   // Позиция, в которой произошли изменения
    this.m_nCount = Count; // Количество добавленных/удаленных элементов
    this.m_pData  = Data;  // Связанные с данным изменением данные из истории

    this.Refresh_BinaryData = function()
    {
        this.m_pData.oldValue = this.m_aPositions[0];
    };

    this.Check_Changes = function(Type, Pos)
    {
        var CurPos = Pos;
        if ( contentchanges_Add === Type )
        {
            for ( var Index = 0; Index < this.m_nCount; Index++ )
            {
                if ( false !== this.m_aPositions[Index] )
                {
                    if ( CurPos <= this.m_aPositions[Index] )
                        this.m_aPositions[Index]++;
                    else
                    {
                        if ( contentchanges_Add === this.m_nType )
                            CurPos++;
                        else //if ( contentchanges_Remove === this.m_nType )
                            CurPos--;
                    }
                }
            }
        }
        else //if ( contentchanges_Remove === Type )
        {
            for ( var Index = 0; Index < this.m_nCount; Index++ )
            {
                if ( false !== this.m_aPositions[Index] )
                {
                    if ( CurPos < this.m_aPositions[Index] )
                        this.m_aPositions[Index]--;
                    else if ( CurPos > this.m_aPositions[Index] )
                    {
                        if ( contentchanges_Add === this.m_nType )
                            CurPos++;
                        else //if ( contentchanges_Remove === this.m_nType )
                            CurPos--;
                    }
                    else //if ( CurPos === this.m_aPositions[Index] )
                    {
                        if ( contentchanges_Remove === this.m_nType )
                        {
                            // Отмечаем, что действия совпали
                            this.m_aPositions[Index] = false;
                            return false;
                        }
                        else
                        {
                            CurPos++;
                        }
                    }
                }
            }
        }

        return CurPos;
    };

    this.Make_ArrayOfSimpleActions = function(Type, Pos, Count)
    {
        // Разбиваем действие на простейшие
        var Positions = [];
        if ( contentchanges_Add === Type )
        {
            for ( var Index = 0; Index < Count; Index++ )
                Positions[Index] = Pos + Index;
        }
        else //if ( contentchanges_Remove === Type )
        {
            for ( var Index = 0; Index < Count; Index++ )
                Positions[Index] = Pos;
        }

        return Positions;
    };

    // Разбиваем сложное действие на простейшие
    this.m_aPositions = this.Make_ArrayOfSimpleActions( Type, Pos, Count );
}

function CContentChanges()
{
    this.m_aChanges = [];

    this.Add = function(Changes)
    {
        this.m_aChanges.push( Changes );
    };

    this.Clear = function()
    {
        this.m_aChanges.length = 0;
    };

    this.Check = function(Type, Pos)
    {
        var CurPos = Pos;
        var Count = this.m_aChanges.length;
        for ( var Index = 0; Index < Count; Index++ )
        {
            var NewPos = this.m_aChanges[Index].Check_Changes(Type, CurPos);
            if ( false === NewPos )
                return false;

            CurPos = NewPos;
        }

        return CurPos;
    };

    this.Refresh = function()
    {
        var Count = this.m_aChanges.length;
        for ( var Index = 0; Index < Count; Index++ )
        {
            this.m_aChanges[Index].Refresh_BinaryData();
        }
    };
}


function DrawingObjectsController(drawingObjects)
{
    this.drawingObjects = drawingObjects;

    this.curState = new NullState(this);
    this.selectedObjects = [];
    this.arrPreTrackObjects = [];
    this.arrTrackObjects = [];

    this.objectsForRecalculate = {};

    this.handleEventMode = HANDLE_EVENT_MODE_HANDLE;
}

var HANDLE_EVENT_MODE_HANDLE = 0;
var HANDLE_EVENT_MODE_CURSOR = 1;

DrawingObjectsController.prototype =
{
    handleAdjustmentHit: function(hit, selectedObject, group)
    {
        if(this.handleEventMode === HANDLE_EVENT_MODE_HANDLE)
        {
            this.arrPreTrackObjects.length = 0;
            if(hit.adjPolarFlag === false)
            {
                this.arrPreTrackObjects.push(new XYAdjustmentTrack(selectedObject, hit.adjNum));
            }
            else
            {
                this.arrPreTrackObjects.push(new PolarAdjustmentTrack(selectedObject, hit.adjNum));
            }
			if(!isRealObject(group))
				this.changeCurrentState(new PreChangeAdjState(this, selectedObject));
			else
			{
				this.changeCurrentState(new PreChangeAdjInGroupState(this, group));
			}
            return true;
        }
        else
        {
			if(!isRealObject(group))
				return {objectId: selectedObject.Get_Id(), cursorType: "crosshair"};
			else
				return {objectId: group.Get_Id(), cursorType: "crosshair"};
        }
    },

    handleHandleHit: function(hit, selectedObject, group)
    {
        if(this.handleEventMode === HANDLE_EVENT_MODE_HANDLE)
        {
			var selected_objects = group ? group.selectedObjects : this.selectedObjects; 
            this.arrPreTrackObjects.length = 0;
            if(hit === 8)
            {
                if(selectedObject.canRotate())
                {
                    for(var i = 0; i < selected_objects.length; ++i)
                    {
                        if(selected_objects[i].canRotate())
                        {
                            this.arrPreTrackObjects.push(selected_objects[i].createRotateTrack());
                        }
                    }
					if(!isRealObject(group))
					{
						if(this.curState.group)
						{
							this.curState.group.resetSelection();
						}
						this.changeCurrentState(new PreRotateState(this, selectedObject));
					}
					else
						this.changeCurrentState(new PreRotateInGroupState(this, group, selectedObject));
                }
            }
            else
            {
                if(selectedObject.canResize())
                {
                    var card_direction = selectedObject.getCardDirectionByNum(hit);
                    for(var j = 0; j < selected_objects.length; ++j)
                    {
                        if(selected_objects[j].canResize())
                            this.arrPreTrackObjects.push(selected_objects[j].createResizeTrack(card_direction));
                    }
					if(!isRealObject(group))
					{
						if(this.curState.group)
						{
							this.curState.group.resetSelection();
						}
						this.changeCurrentState(new PreResizeState(this, selectedObject, card_direction));
					}
					else
						this.changeCurrentState(new PreResizeInGroupState(this, group, selectedObject, card_direction));
				}
            }
            return true;
        }
        else
        {
            var card_direction = selectedObject.getCardDirectionByNum(hit);
            return {objectId: group ? group.Get_Id() : selectedObject.Get_Id(), cursorType: hit === 8 ? "crosshair" : CURSOR_TYPES_BY_CARD_DIRECTION[card_direction]};
        }
    },

    handleMoveHit: function(object, e, x, y, group)
    {
        if(this.handleEventMode === HANDLE_EVENT_MODE_HANDLE)
        {
			var selector = group ? group : this;
            if(object.canMove())
            {
                this.arrPreTrackObjects.length = 0;
                var is_selected =  object.selected;
                if(!(e.CtrlKey || e.ShiftKey) && !is_selected)
                    selector.resetSelection();
                selector.selectObject(object);
				if(!is_selected)
					this.updateOverlay();
                this.checkSelectedObjectsForMove(group);
				if(!isRealObject(group))
				{
					if(this.curState.group)
					{
						this.curState.group.resetSelection();
					}
					this.changeCurrentState(new PreMoveState(this, x, y, e.ShiftKey, e.CtrlKey,  object, is_selected, true));
				}
				else
					this.changeCurrentState(new PreMoveInGroupState(this, group, x, y, e.ShiftKey, e.CtrlKey, object,  is_selected));
            }
            return true;
        }
        else
        {
            return {objectId: group ? group.Get_Id() : object.Get_Id(), cursorType: "move"};
        }
    },

    handleEndMoveTrack: function(e)
    {
        if(!e.CtrlKey)
        {
            this.handleEndResizeTrack();
        }
        else
        {
            //TODO: сделать копирование
        }
    },


    handleNoHit: function()
    {
        if(this.handleEventMode === HANDLE_EVENT_MODE_HANDLE)
        {
            this.resetSelectionState();
        }
        else
        {
            return null;
        }
    },

	handleClickOnSelectedGroup: function(group, e, x, y)
	{
		this.changeCurrentState(new GroupState(this, group));
		this.onMouseDown(e, x, y);
		this.onMouseUp(e, x, y);
	},
	
    getSnapArraysTrackObjects: function()
    {
        var snapX = [], snapY = [];
        for(var i = 0; i < this.arrTrackObjects.length; ++i)
        {
            if(this.arrTrackObjects[i].originalObject && this.arrTrackObjects[i].originalObject.getSnapArrays)
            {
                this.arrTrackObjects[i].originalObject.getSnapArrays(snapX, snapY);
            }
        }
        return {snapX: snapX, snapY: snapY};
    },

    handleTextHit: function(object, e, x, y)
    {
        if(this.handleEventMode === HANDLE_EVENT_MODE_HANDLE)
        {
            this.resetSelection();
            this.selectObject(object);
            object.selectionSetStart(e, x, y);
            this.changeCurrentState(new TextAddState(this, object));
            if(e.ClickCount < 2)
                this.updateSelectionState();
            return true;
        }
        else
        {
            return {objectId: object.Get_Id(), cursorType: "text"};
        }
    },

    handleTextHitGroup: function(object, group, e)
    {
        if(this.handleEventMode === HANDLE_EVENT_MODE_HANDLE)
        {
            this.resetSelection();
            this.selectObject(group);
            group.selectObject(object);
            object.selectionSetStart(e, x, y);
            this.changeCurrentState(new TextAddInGroup(this, group, object));
            if(e.ClickCount < 2)
                this.updateSelectionState();
            return true;
        }
        else
        {
            return {objectId: group.Get_Id(), cursorType: "text"};
        }
    },

    handleStartTrackAdj: function(e, x, y)
    {
        this.arrTrackObjects.push(this.arrPreTrackObjects[0]);
        this.arrPreTrackObjects.length = 0;
        this.changeCurrentState(new ChangeAdjState(this, this.curState.majorObject));
        this.onMouseMove(e, x, y);
    },

    handleTrackAdj: function(e, x, y)
    {
        this.arrTrackObjects[0].track(x, y);
        this.updateOverlay();
    },

    handleEndTrackAdj: function()
    {
        var track_object = this.arrTrackObjects[0];
        var _this = this;
		var group = this.curState.group;
        function callback()
        {
            History.Create_NewPoint();
            track_object.trackEnd();
            _this.startRecalculate();
        }
        this.checkSelectedObjectsAndFireCallback(callback, []);
        this.arrTrackObjects.length = 0;
		if(group)
			this.changeCurrentState(new GroupState(this, group));
		else
			this.changeCurrentState(new NullState(this));
    },

    handleStartRotateTrack: function(e, x, y)
    {
        this.changeCurrentState(new RotateState(this, this.curState.majorObject));
        this.swapTrackObjects();
        this.onMouseMove(e, x, y);
    },

    handleRotateTrack: function(e, x, y)
    {
        var angle = this.curState.majorObject.getRotateAngle(x, y);
        this.rotateTrackObjects(angle, e);
        this.updateOverlay();
    },

    handleStartResizeTrack: function(e, x, y)
    {
        this.swapTrackObjects();
        this.changeCurrentState(new ResizeState(this, this.curState.majorObject, this.curState.cardDirection));
        this.onMouseMove(e, x, y);
    },

    handleResizeTrack: function(e, x, y)
    {
        var point_x, point_y;
        var snap_object_x = GetSnapObject([x], 0, this.curState.snapX);
        var snap_object_y = GetSnapObject([y], 0, this.curState.snapY);
        if(snap_object_x.point !== null)
        {
            point_x = snap_object_x.point;
        }
        else
        {
            point_x = x;
        }
        if(snap_object_y.point !== null)
        {
            point_y = snap_object_y.point;
        }
        else
        {
            point_y = y;
        }
        var resize_coefficients = this.curState.majorObject.getResizeCoefficients(this.curState.handleNum, point_x, point_y);
        this.trackResizeObjects(resize_coefficients.kd1, resize_coefficients.kd2, e);
        this.updateOverlay();
    },


    handleEndResizeTrack: function()
    {
        var tracks = this.getCopyTrackArray();
        var _this = this;
		var group = this.curState.group;
        function callback()
        {
            History.Create_NewPoint();
            for(var i = 0; i < tracks.length; ++i)
            {
                tracks[i].trackEnd();
            }
			if(isRealObject(group))
			{
				group.updateCoordinatesAfterInternalResize();
			}
            _this.startRecalculate();
        }
        this.checkSelectedObjectsAndFireCallback(callback, []);
        this.arrTrackObjects.length = 0;
		if(!isRealObject(this.curState.group))
			this.changeCurrentState(new NullState(this));
		else
			this.changeCurrentState(new GroupState(this, this.curState.group));
	},


    handleMoveMouseDown: function()
    {
        if(this.handleEventMode === HANDLE_EVENT_MODE_HANDLE)
        {
            return true;
        }
        else
        {
            return {cursorType: "move", objectId: this.curState.group ? this.curState.group.Get_Id() : this.curState.majorObject.Get_Id()};
        }
    },


    handleAdjMouseDown: function()
    {
        if(this.handleEventMode === HANDLE_EVENT_MODE_HANDLE)
        {
            return true;
        }
        else
        {
            return {cursorType: "crosshair", objectId: this.curState.group ? this.curState.group.Get_Id() : this.curState.majorObject.Get_Id()};
        }
    },

    handleRotateMouseDown: function()
    {
        if(this.handleEventMode === HANDLE_EVENT_MODE_HANDLE)
        {
            return true;
        }
        else
        {
            return {cursorType: "crosshair", objectId: this.curState.majorObject.Get_Id()};
        }
    },

    handleResizeMouseDown: function()
    {
        if(this.handleEventMode === HANDLE_EVENT_MODE_HANDLE)
        {
            return true;
        }
        else
        {
            return {cursorType: CURSOR_TYPES_BY_CARD_DIRECTION[this.curState.cardDirection], objectId: this.curState.majorObject.Get_Id()};
        }
    },

    handleStartTrackNewShape: function(persetGeom, x, y)
    {
        if(this.handleEventMode === HANDLE_EVENT_MODE_HANDLE)
        {
            this.changeCurrentState(new BeginTrackNewShapeState(this, persetGeom, x, y));
            return true;
        }
        else
        {
            return {cursorType: "crosshair", objectId: null/*TODO: выяснить какой Id нужен верхнему классу*/};
        }
    },

    handleTarckNewShapeMouseDown: function()
    {
        if(this.handleEventMode === HANDLE_EVENT_MODE_HANDLE)
        {
            return true;
        }
        else
        {
            return {cursorType: "crosshair", objectId: null/*TODO: выяснить какой Id нужен верхнему классу*/};
        }
    },

    getSnapArrays: function()
    {
        var drawing_objects = this.getDrawingObjects();
        var snapX = [];
        var snapY = [];
        for(var i = 0; i < drawing_objects.length; ++i)
        {
            if(drawing_objects[i].getSnapArrays)
            {
                drawing_objects[i].getSnapArrays(snapX, snapY);
            }
        }
        return {snapX: snapX, snapY: snapY};
    },


    getCopyTrackArray: function()
    {
        var ret = [];
        for(var i = 0; i < this.arrTrackObjects.length; ++i)
        {
            ret.push(this.arrTrackObjects[i]);
        }
        return ret;
    },

    handleEndRotateTrack: function()
    {
        var tracks = this.getCopyTrackArray();
        var _this = this;
		var group = this.curState.group;
        function callback()
        {
            History.Create_NewPoint();
            for(var i = 0; i < tracks.length; ++i)
            {
                tracks[i].trackEnd();
            }
			if(isRealObject(group))
			{
				group.updateCoordinatesAfterInternalResize();
			}
            _this.startRecalculate();
        }
        this.checkSelectedObjectsAndCallback(callback, []);
        this.arrTrackObjects.length = 0;
		if(!group)
			this.changeCurrentState(new NullState(this));
		else
			this.changeCurrentState(new GroupState(this, group));
    },
	
	handleMouseUpCtrlShiftOnSelectedObject: function(object)
	{
		object.deselect(this);
		this.changeCurrentState(new NullState(this));
	},

    selectObject: function(object)
    {
        object.selected = true;
        for(var i = 0; i < this.selectedObjects.length; ++i)
        {
            if(this.selectedObjects[i] === object)
            {
                break;
            }
        }
        if(i === this.selectedObjects.length)
            this.selectedObjects.push(object);
        if(this.selectedObjects.length === 1 && this.selectedObjects[0] instanceof CChartSpace)
            window["asc"]["editor"].handlers.trigger("asc_onSelectChart", this.selectedObjects[0]);
    },


    recalculate: function()
    {
        for(var key in this.objectsForRecalculate)
        {
            this.objectsForRecalculate[key].recalculate();
        }
        this.objectsForRecalculate = {};
    },

    addContentChanges: function(changes)
    {
       // this.contentChanges.Add(changes);
    },

    refreshContentChanges: function()
    {
        //this.contentChanges.Refresh();
        //this.contentChanges.Clear();
    },

    getAllFontNames: function()
    {
    },

    setCellFontName: function (fontName) {
        this.checkSelectedObjectsAndCallback(this.setCellFontNameCallBack, [fontName]);

    },

    setCellFontSize: function (fontSize) {
        this.checkSelectedObjectsAndCallback(this.setCellFontSizeCallBack, [fontSize]);

    },

    setCellBold: function (isBold) {
        this.checkSelectedObjectsAndCallback(this.setCellBoldCallBack, [isBold]);

    },

    setCellItalic: function (isItalic) {
        this.checkSelectedObjectsAndCallback(this.setCellItalicCallBack, [isItalic]);

    },

    setCellUnderline: function (isUnderline) {
        this.checkSelectedObjectsAndCallback(this.setCellUnderlineCallBack, [isUnderline]);

    },

    setCellStrikeout: function (isStrikeout) {
        this.checkSelectedObjectsAndCallback(this.setCellStrikeoutCallBack, [isStrikeout]);
    },

    setCellSubscript: function (isSubscript) {
        this.checkSelectedObjectsAndCallback(this.setCellSubscriptCallBack, [isSubscript]);

    },

    setCellSuperscript: function (isSuperscript) {
        this.checkSelectedObjectsAndCallback(this.setCellSuperscriptCallBack, [isSuperscript]);

    },

    setCellAlign: function (align) {
        this.checkSelectedObjectsAndCallback(this.setCellAlignCallBack, [align]);

    },

    setCellVertAlign: function (align) {
        this.checkSelectedObjectsAndCallback(this.setCellVertAlignCallBack, [align]);

    },

    setCellTextWrap: function (isWrapped) {
        this.checkSelectedObjectsAndCallback(this.setCellTextWrapCallBack, [isWrapped]);

    },

    setCellTextShrink: function (isShrinked) {
        this.checkSelectedObjectsAndCallback(this.setCellTextShrinkCallBack, [isShrinked]);

    },

    setCellTextColor: function (color) {
        this.checkSelectedObjectsAndCallback(this.setCellTextColorCallBack, [color]);

    },

    setCellBackgroundColor: function (color) {
        this.checkSelectedObjectsAndCallback(this.setCellBackgroundColorCallBack, [color]);

    },


    setCellAngle: function (angle) {
        this.checkSelectedObjectsAndCallback(this.setCellAngleCallBack, [angle]);

    },

    setCellStyle: function (name) {
        this.checkSelectedObjectsAndCallback(this.setCellStyleCallBack, [name]);

    },

    // Увеличение размера шрифта
    increaseFontSize: function () {
        this.checkSelectedObjectsAndCallback(this.increaseFontSizeCallBack, []);

    },

    // Уменьшение размера шрифта
    decreaseFontSize: function () {
        this.checkSelectedObjectsAndCallback(this.decreaseFontSizeCallBack, []);

    },

    setCellFontNameCallBack: function (fontName) {
        if(typeof this.curState.setCellFontName === "function")
        {
            History.Create_NewPoint();
            this.curState.setCellFontName(fontName);
        }
    },

    setCellFontSizeCallBack: function (fontSize) {
        if(typeof this.curState.setCellFontSize === "function")
        {
            History.Create_NewPoint();
            this.curState.setCellFontSize(fontSize);
        }
    },

    setCellBoldCallBack: function (isBold) {
        if(typeof this.curState.setCellBold === "function")
        {
            History.Create_NewPoint();
            this.curState.setCellBold(isBold);
        }
    },

    setCellItalicCallBack: function (isItalic) {
        if(typeof this.curState.setCellItalic === "function")
        {
            History.Create_NewPoint();
            this.curState.setCellItalic(isItalic);
        }
    },

    setCellUnderlineCallBack: function (isUnderline) {
        if(typeof this.curState.setCellUnderline === "function")
        {
            History.Create_NewPoint();
            this.curState.setCellUnderline(isUnderline);
        }
    },

    setCellStrikeoutCallBack: function (isStrikeout) {
        if(typeof this.curState.setCellStrikeout === "function")
        {
            History.Create_NewPoint();
            this.curState.setCellStrikeout(isStrikeout);
        }
    },

    setCellSubscriptCallBack: function (isSubscript) {
        if(typeof this.curState.setCellSubscript === "function")
        {
            History.Create_NewPoint();
            this.curState.setCellSubscript(isSubscript);
        }
    },

    setCellSuperscriptCallBack: function (isSuperscript) {
        if(typeof this.curState.setCellSuperscript === "function")
        {
            History.Create_NewPoint();
            this.curState.setCellSuperscript(isSuperscript);
        }
    },

    deleteSelectedObjects: function()
    {
        this.remove(-1);
        /*var drawingObjectsController = this;
         for(var i = drawingObjectsController.selectedObjects.length-1; i > -1 ; --i)
         {
         drawingObjectsController.selectedObjects[i].deleteDrawingBase();
         }
         drawingObjectsController.resetSelectionState();*/
    },

    setCellAlignCallBack: function (align) {
        if(typeof this.curState.setCellAlign === "function")
        {
            History.Create_NewPoint();
            this.curState.setCellAlign(align);
        }
    },

    setCellVertAlignCallBack: function (align) {
        if(typeof this.curState.setCellVertAlign === "function")
        {
            History.Create_NewPoint();
            this.curState.setCellVertAlign(align);
        }
    },

    setCellTextWrapCallBack: function (isWrapped) {
        if(typeof this.curState.setCellTextWrap === "function")
        {
            History.Create_NewPoint();
            this.curState.setCellTextWrap(isWrapped);
        }
    },

    setCellTextShrinkCallBack: function (isShrinked) {
        if(typeof this.curState.setCellTextShrink === "function")
        {
            History.Create_NewPoint();
            this.curState.setCellTextShrink(isShrinked);
        }
    },

    setCellTextColorCallBack: function (color) {
        if(typeof this.curState.setCellTextColor === "function")
        {
            History.Create_NewPoint();
            this.curState.setCellTextColor(color);
        }

    },

    setCellBackgroundColorCallBack: function (color) {
        if(typeof this.curState.setCellBackgroundColor === "function")
        {
            History.Create_NewPoint();
            this.curState.setCellBackgroundColor(color);
        }
    },


    setCellAngleCallBack: function (angle) {
        if(typeof this.curState.setCellAngle === "function")
        {
            History.Create_NewPoint();
            this.curState.setCellAngle(angle);
        }
    },

    setCellStyleCallBack: function (name) {
        if(typeof this.curState.setCellStyle === "function")
        {
            History.Create_NewPoint();
            this.curState.setCellStyle(name);
        }
    },


    setPargarphIndent: function(ind)
    {
        switch(this.curState.id)
        {
            case STATES_ID_TEXT_ADD:
            case STATES_ID_TEXT_ADD_IN_GROUP:
            {
                this.curState.textObject.setParagraphIndent(ind);
                break;
            }
            case STATES_ID_GROUP:
            {
                var selected_objects = this.curState.group.selectedObjects;
                for(var i = 0; i < selected_objects.length; ++i)
                {
                    if(selected_objects[i].setAllParagraphIndent)
                        selected_objects[i].setAllParagraphIndent(ind);
                }
                break;
            }

            default:
            {
                var selected_objects = this.selectedObjects;
                for(var i = 0; i < selected_objects.length; ++i)
                {
                    if(selected_objects[i].setAllParagraphIndent)
                        selected_objects[i].setAllParagraphIndent(ind);
                }
                break;
            }

        }
    },


    setPargarphSpacing: function(ind)
    {
        switch(this.curState.id)
        {
            case STATES_ID_TEXT_ADD:
            case STATES_ID_TEXT_ADD_IN_GROUP:
            {
                this.curState.textObject.setParagraphSpacing(ind);
                break;
            }
            case STATES_ID_GROUP:
            {
                var selected_objects = this.curState.group.selectedObjects;
                for(var i = 0; i < selected_objects.length; ++i)
                {
                    if(selected_objects[i].setAllParagraphSpacing)
                        selected_objects[i].setAllParagraphSpacing(ind);
                }
                break;
            }

            default:
            {
                var selected_objects = this.selectedObjects;
                for(var i = 0; i < selected_objects.length; ++i)
                {
                    if(selected_objects[i].setAllParagraphSpacing)
                        selected_objects[i].setAllParagraphSpacing(ind);
                }
                break;
            }

        }
    },

    setPargaraphTabs: function(ind)
    {
        switch(this.curState.id)
        {
            case STATES_ID_TEXT_ADD:
            case STATES_ID_TEXT_ADD_IN_GROUP:
            {
                this.curState.textObject.setParagraphTabs(ind);
                break;
            }
            case STATES_ID_GROUP:
            {
                var selected_objects = this.curState.group.selectedObjects;
                for(var i = 0; i < selected_objects.length; ++i)
                {
                    if(selected_objects[i].setAllParagraphTabs)
                        selected_objects[i].setAllParagraphTabs(ind);
                }
                break;
            }

            default:
            {
                var selected_objects = this.selectedObjects;
                for(var i = 0; i < selected_objects.length; ++i)
                {
                    if(selected_objects[i].setAllParagraphTabs)
                        selected_objects[i].setAllParagraphTabs(ind);
                }
                break;
            }

        }
    },

    // Увеличение размера шрифта
    increaseFontSizeCallBack: function () {
        if(typeof this.curState.increaseFontSize === "function")
        {
            History.Create_NewPoint();
            this.curState.increaseFontSize();
        }
    },

    // Уменьшение размера шрифта
    decreaseFontSizeCallBack: function () {
        if(typeof this.curState.decreaseFontSize === "function")
        {
            History.Create_NewPoint();
            this.curState.decreaseFontSize();
        }
    },

    insertHyperlink: function (options) {
        if(typeof this.curState.insertHyperlink === "function")
        {
            this.curState.insertHyperlink(options);
        }
    },

    removeHyperlink: function () {
        // TODO
    },

    canAddHyperlink: function() {
        if(this.curState.textObject)
        {
            return this.curState.textObject.txBody.content.Hyperlink_CanAdd();
        }
        return false;
    },

    getParagraphParaPr: function()
    {
        switch(this.curState.id)
        {
            case STATES_ID_TEXT_ADD:
            {
                var pr = this.curState.textObject.getParagraphParaPr();
                if(pr != null)
                    return pr;
                else
                    return new CParaPr();
            }
            case STATES_ID_TEXT_ADD_IN_GROUP:
            {
                if(typeof this.curState.textObject.getParagraphParaPr === "function")
                {
                    pr = this.curState.textObject.getParagraphParaPr();
                    if(pr != null)
                        return pr;
                    return new CParaPr();
                }
                return new CParaPr();

            }
            case STATES_ID_CHART:
            case STATES_ID_PRE_MOVE_INTERNAL_CHART_OBJECT:
            {
                var chart = this.curState.chart;
                var selected_title;
                if(chart.chartTitle && chart.chartTitle.selected)
                {
                    selected_title = chart.chartTitle;
                }
                else if(chart.hAxisTitle && chart.hAxisTitle.selected)
                {
                    selected_title = chart.hAxisTitle;
                }
                else if(chart.vAxisTitle && chart.vAxisTitle.selected)
                {
                    selected_title = chart.vAxisTitle;
                }
                if(selected_title)
                {
                    return selected_title.getAllParagraphParaPr();
                }
                else
                {
                    return null;
                }
                break;
            }
            case STATES_ID_CHART_TEXT_ADD:
            {
                return this.curState.textObject.getParagraphParaPr();
                break;
            }
            default:
            {
                var result = null;
                var selection_array = this.selectedObjects;
                for(var i = 0; i < selection_array.length; ++i)
                {
                    if ( typeof(selection_array[i].getAllParagraphParaPr) === "function" )
                    {
                        var cur_pr = selection_array[i].getAllParagraphParaPr();
                        if(cur_pr != null)
                        {
                            if(result == null)
                                result = cur_pr;
                            else
                                result = result.Compare(cur_pr);
                        }
                    }
                }
                if(result != null)
                    return result;
                return new CParaPr();
            }
        }
    },

    getParagraphTextPr: function()
    {
        switch(this.curState.id)
        {
            case STATES_ID_TEXT_ADD:
            {
                var pr = this.curState.textObject.getParagraphTextPr();
                /*if(pr != null)
                 return pr;
                 return new CTextPr();*/
                return pr;
            }
            case STATES_ID_TEXT_ADD_IN_GROUP:
            {

                if(typeof this.curState.textObject.getParagraphTextPr === "function")
                {
                    pr = this.curState.textObject.getParagraphTextPr();
                    /*if(pr != null)
                     return pr;
                     return new CTextPr();*/
                    return pr;
                }
                //return new CTextPr();
                return null;
            }
            case STATES_ID_CHART:
            case STATES_ID_PRE_MOVE_INTERNAL_CHART_OBJECT:
            {
                var chart = this.curState.chart;
                var selected_title;
                if(chart.chartTitle && chart.chartTitle.selected)
                {
                    selected_title = chart.chartTitle;
                }
                else if(chart.hAxisTitle && chart.hAxisTitle.selected)
                {
                    selected_title = chart.hAxisTitle;
                }
                else if(chart.vAxisTitle && chart.vAxisTitle.selected)
                {
                    selected_title = chart.vAxisTitle;
                }
                if(selected_title)
                {
                    return selected_title.getAllParagraphTextPr();
                }
                else
                {
                    return null;
                }
                break;
            }
            case STATES_ID_CHART_TEXT_ADD:
            {
                return this.curState.textObject.getParagraphTextPr();
                break;
            }
            default:
            {
                var result = null;
                var selection_array = this.selectedObjects;
                for(var i = 0; i < selection_array.length; ++i)
                {
                    if ( typeof(selection_array[i].getAllParagraphTextPr) === "function" )
                    {
                        var cur_pr = selection_array[i].getAllParagraphTextPr();
                        if(cur_pr != null)
                        {
                            if(result == null)
                                result = cur_pr;
                            else
                                result = result.Compare(cur_pr);
                        }
                    }
                }
                /*if(result != null)
                 return result;
                 return new CTextPr();*/

                return result;
            }
        }
    },

    getColorMap: function()
    {
        return this.defaultColorMap;
    },

    getAscChartObject: function()
    {
        var chart = null;
        for (var i = 0; i < this.selectedObjects.length; i++) {
            if ( this.selectedObjects[i].isChart() )
            {
                this.selectedObjects[i].drObjects = this;
                return this.selectedObjects[i];
            }
        }
        return chart;
    },

    editChartDrawingObjects: function(chart)
    {
        if(this.selectedObjects.length === 1
            && (this.selectedObjects[0].isChart()
            || (isRealObject(this.curState.group) && this.curState.group.selectedObjects.length === 1 && this.curState.group.selectedObjects[0].isChart())))
        {

            this.checkSelectedObjectsAndCallback(this.editChartCallback, [chart]);
        }

    },



    getSelectedObjectsByTypes: function()
    {
        var ret = {shapes: [], images: [], groups: [], charts: []};
        var selected_objects = this.curState.group ? this.curState.group.selectedObjects : this.selectedObjects;
        for(var i = 0;  i < selected_objects.length; ++i)
        {
            var drawing = selected_objects[i];
            var type = drawing.getObjectType();
            switch(type)
            {
                case historyitem_type_Shape:
                {
                    ret.shapes.push(drawing);
                    break;
                }
                case historyitem_type_ImageShape:
                {
                    ret.images.push(drawing);
                    break;
                }
                case historyitem_type_GroupShape:
                {
                    ret.groups.push(drawing);
                    break;
                }
                case historyitem_type_ChartSpace:
                {
                    ret.charts.push(drawing);
                    break;
                }
            }
        }
        return ret;
    },

    editChartCallback: function(chartSettings)
    {
        var objects_by_types = this.getSelectedObjectsByTypes();
        if(objects_by_types.charts.length === 1)
        {
            //Style Index
            var chart_space = objects_by_types.charts[0];
            var style_index = chartSettings.getStyle();
            if(isRealNumber(style_index) && style_index > 0 && style_index < 49)
            {
                chart_space.setStyle(style_index);
            }


            //Title Settings
            var chart = chart_space.chart;
            var title_show_settings = chartSettings.getTitle();
            if(title_show_settings === c_oAscChartTitleShowSettings.none)
            {
                if(chart.title)
                {
                    chart.setTitle(null);
                }
            }
            else if(title_show_settings === c_oAscChartTitleShowSettings.noOverlay
                || title_show_settings === c_oAscChartTitleShowSettings.overlay)
            {
                if(!chart.title)
                {
                    chart.setTitle(new CTitle());
                }
                chart.title.setOverlay(title_show_settings === c_oAscChartTitleShowSettings.overlay);
            }
            //Row/Cols
            if(chartSettings.getRowCols() !== null)
                chart_space.swapData();
            var plot_area = chart.plotArea;
            //horAxisLabel
            var hor_axis_label_setting = chartSettings.getHorAxisLabel();
            if(hor_axis_label_setting !== null)
            {
                var hor_axis = plot_area.getHorizontalAxis();   //TODO: запрашивать у chart_type
                if(hor_axis)
                {
                    switch (hor_axis_label_setting)
                    {
                        case c_oAscChartHorAxisLabelShowSettings.none:
                        {
                            hor_axis.setTitle(null);
                            break;
                        }
                        case c_oAscChartHorAxisLabelShowSettings.noOverlay:
                        {
                            if(!hor_axis.title)
                            {
                                hor_axis.setTitle(new CTitle());
                            }
                            if(hor_axis.title.overlay)
                                hor_axis.title.setOverlay(false);
                            break;
                        }
                    }
                }
            }
            //vertAxis
            var vert_axis_labels_settings = chartSettings.getVertAxisLabel();
            if(vert_axis_labels_settings !== null)
            {
                var vert_axis = plot_area.getVerticalAxis(); //TODO: запрашивать у chart_type
                if(vert_axis)
                {
                    switch (vert_axis_labels_settings)
                    {
                        case c_oAscChartVertAxisLabelShowSettings.none:
                        {
                            if(vert_axis.title)
                            {
                                vert_axis.setTitle(null);
                            }
                            break;
                        }
                        case c_oAscChartVertAxisLabelShowSettings.vertical:
                        {
                            //TODO: пока СDocumentContent не поддерживает вертикальный текст, может быть будет когда-нибудь, хотя вряд ли.
                            break;
                        }
                        default:
                        {
                            if( vert_axis_labels_settings === c_oAscChartVertAxisLabelShowSettings.rotated
                                || vert_axis_labels_settings === c_oAscChartVertAxisLabelShowSettings.horizontal)
                            {
                                if(!vert_axis.title)
                                {
                                    vert_axis.setTitle(new CTitle());
                                }
                                if(!vert_axis.title.txPr)
                                {
                                    vert_axis.title.setTxPr(new CTextBody());
                                }
                                if(!vert_axis.title.txPr.bodyPr)
                                {
                                    vert_axis.title.txPr.setBodyPr(new CBodyPr());
                                }
                                vert_axis.title.txPr.bodyPr.reset();
                                vert_axis.title.txPr.bodyPr.setRot(vert_axis_labels_settings === c_oAscChartVertAxisLabelShowSettings.rotated ? Math.PI/2 : 0);
                                vert_axis.title.txPr.bodyPr.setVert(nVertTThorz);
                            }
                        }
                    }
                }
            }
            //legend
            var legend_pos_settings =  chartSettings.getLegendPos();
            if(legend_pos_settings !== null)
            {
                if(legend_pos_settings === c_oAscChartLegendShowSettings.none)
                {
                    if(chart.legend)
                    {
                        chart.setLegend(null);
                    }
                }
                else
                {
                    if(!chart.legend)
                    {
                        chart.setLegend(new CLegend());
                    }
                    if(isRealNumber(LEGEND_POS_MAP[legend_pos_settings]))
                    {
                        chart.legend.setLegendPos(LEGEND_POS_MAP[legend_pos_settings]);
                        var b_overlay = c_oAscChartLegendShowSettings.leftOverlay === legend_pos_settings || legend_pos_settings === c_oAscChartLegendShowSettings.rightOverlay;
                        if(chart.legend.overlay !== b_overlay)
                        {
                            chart.legend.setOverlay(b_overlay);
                        }
                    }
                }
            }

            //gridLines
            //Hor GridLInes
            var setAxisGridLines = function(axis, gridLinesSettings)
            {
                if(axis)
                {
                    switch(gridLinesSettings)
                    {
                        case c_oAscGridLinesSettings.none:
                        {
                            if(axis.majorGridlines)
                                axis.setMajorGridlines(null);
                            if(axis.minorGridlines)
                                axis.setMinorGridlines(null);
                            break;
                        }
                        case c_oAscGridLinesSettings.major:
                        {
                            if(!axis.majorGridlines)
                                axis.setMajorGridlines(new CSpPr());
                            if(axis.minorGridlines)
                                axis.setMinorGridlines(null);
                            break;
                        }
                        case c_oAscGridLinesSettings.minor:
                        {
                            if(!axis.minorGridlines)
                                axis.setMinorGridlines(new CSpPr());
                            if(axis.majorGridlines)
                                axis.setMajorGridlines(null);
                            break;
                        }
                        case c_oAscGridLinesSettings.majorMinor:
                        {
                            if(!axis.minorGridlines)
                                axis.setMinorGridlines(new CSpPr());
                            if(!axis.majorGridlines)
                                axis.setMajorGridlines(new CSpPr());
                            break;
                        }
                    }
                }
            };

            setAxisGridLines(plot_area.getVerticalAxis(), chartSettings.getHorGridLines());
            setAxisGridLines(plot_area.getHorizontalAxis(), chartSettings.getVertGridLines());

            var chart_type = plot_area.chart;
            //Data Labels
            var data_labels_pos_setting = chartSettings.getDataLabelsPos();
            if(isRealNumber(data_labels_pos_setting))
            {
                if(data_labels_pos_setting === c_oAscChartDataLabelsPos.none)
                {
                    chart_type.setDLbls(null);
                }
                else
                {
                    if(isRealNumber(DLBL_POS_DEFINES_MAP[data_labels_pos_setting]))
                    {
                        if(!chart_type.dLbls)
                        {
                            var d_lbls = new CDLbls();
                            d_lbls.setShowVal(true);
                            chart_type.setDLbls(d_lbls);
                        }
                        chart_type.dLbls.setDLblPos(DLBL_POS_DEFINES_MAP[data_labels_pos_setting]);
                    }
                }
            }
            //Vert Axis
            //TODO

            //Hor Axis
            //TODO
            var i;
            var type = chartSettings.getType();
            var need_groupping, need_num_fmt, need_bar_dir;
            var val_axis, new_chart_type, object_type, axis_obj ;
            var axis_by_types;
            var val_ax, cat_ax;
            object_type = chart_type.getObjectType();

            var checkSwapAxis = function(plotArea, chartType, newChartType)
            {
                if(chartType.getAxisByTypes )
                {
                    var axis_by_types = chartType.getAxisByTypes(), cat_ax, val_ax;
                    if(axis_by_types.catAx.length > 0 && axis_by_types.valAx.length > 0)
                    {
                        cat_ax = axis_by_types.catAx[0];
                        val_ax = axis_by_types.valAx[0];
                    }
                }
                if(!val_ax || !cat_ax)
                {
                    var axis_obj = CreateDefaultAxises(need_num_fmt);
                    cat_ax = axis_obj.catAx;
                    val_ax = axis_obj.valAx;
                }
                newChartType.addAxId(cat_ax);
                newChartType.addAxId(val_ax);
                plotArea.addAxis(cat_ax);
                plotArea.addAxis(val_ax);
            };

            var replaceChart = function(plotArea, chartType, newChartType)
            {
                plotArea.addChart(newChartType, 0);
                plotArea.removeCharts(1, plotArea.charts.length - 1);
                newChartType.setFromOtherChart(chartType);
            };

            switch(type)
            {
                case c_oAscChartTypeSettings.barNormal     :
                case c_oAscChartTypeSettings.barStacked    :
                case c_oAscChartTypeSettings.barStackedPer :
                case c_oAscChartTypeSettings.hBarNormal    :
                case c_oAscChartTypeSettings.hBarStacked   :
                case c_oAscChartTypeSettings.hBarStackedPer:
                {
                    if(type === c_oAscChartTypeSettings.barNormal || type === c_oAscChartTypeSettings.hBarNormal)
                        need_groupping = BAR_GROUPING_CLUSTERED;
                    else if(type === c_oAscChartTypeSettings.barStacked || type === c_oAscChartTypeSettings.hBarStacked)
                        need_groupping = BAR_GROUPING_STACKED;
                    else
                        need_groupping = BAR_GROUPING_PERCENT_STACKED;

                    if(type === c_oAscChartTypeSettings.barNormal || type === c_oAscChartTypeSettings.barStacked
                        || type === c_oAscChartTypeSettings.barNormal || type === c_oAscChartTypeSettings.barStacked
                        || type === c_oAscChartTypeSettings.hBarNormal || type === c_oAscChartTypeSettings.hBarStacked
                        || type === c_oAscChartTypeSettings.hBarNormal || type === c_oAscChartTypeSettings.hBarStacked)
                        need_num_fmt = "General";
                    else
                        need_num_fmt = "0%";

                    if(type === c_oAscChartTypeSettings.barNormal || type === c_oAscChartTypeSettings.barStacked || type === c_oAscChartTypeSettings.barStackedPer)
                        need_bar_dir = BAR_DIR_COL;
                    else
                        need_bar_dir = BAR_DIR_BAR;

                    if(chart_type.getObjectType() === historyitem_type_BarChart)
                    {
                        if(chart_type.grouping !== need_groupping)
                            chart_type.setGrouping(need_groupping);

                        axis_by_types = chart_type.getAxisByTypes();
                        if(chart_type.barDir !== need_bar_dir)
                        {
                            val_axis = axis_by_types.valAx;
                            if(need_bar_dir === BAR_DIR_BAR)
                            {
                                for(i = 0; i < val_axis.length; ++i)
                                    val_axis[i].setAxPos(AX_POS_B);

                                for(i = 0; i < axis_by_types.catAx.length; ++i)
                                    axis_by_types.catAx[i].setAxPos(AX_POS_L);
                            }
                            chart_type.setBarDir(need_bar_dir);
                        }

                        val_axis = axis_by_types.valAx;
                        for(i = 0; i < val_axis.length; ++i)
                        {
                            if(val_axis[i].numFmt.formatCode !== need_num_fmt)
                                val_axis[i].numFmt.setFormatCode(need_num_fmt);
                        }
                    }
                    else
                    {
                        new_chart_type = new CBarChart();
                        replaceChart(plot_area, chart_type, new_chart_type);
                        checkSwapAxis(plot_area, chart_type, new_chart_type);
                        new_chart_type.setGrouping(need_groupping);
                        new_chart_type.setBarDir(need_bar_dir);
                        new_chart_type.setGapWidth(150);

                        axis_by_types = new_chart_type.getAxisByTypes();
                        val_axis = axis_by_types.valAx;
                        for(i = 0; i < val_axis.length; ++i)
                        {
                            if(val_axis[i].numFmt.formatCode !== need_num_fmt)
                                val_axis[i].numFmt.setFormatCode(need_num_fmt);
                            if(need_bar_dir = BAR_DIR_BAR)
                                val_axis[i].setAxPos(AX_POS_B);
                        }
                        if(need_bar_dir = BAR_DIR_BAR)
                        {
                            for(i = 0; i < axis_by_types.catAx.length; ++i)
                                axis_by_types.catAx[i].setAxPos(AX_POS_L);
                        }
                    }
                    break;
                }
                case c_oAscChartTypeSettings.lineNormal           :
                case c_oAscChartTypeSettings.lineStacked          :
                case c_oAscChartTypeSettings.lineStackedPer      :
                case c_oAscChartTypeSettings.lineNormalMarker    :
                case c_oAscChartTypeSettings.lineStackedMarker   :
                case c_oAscChartTypeSettings.lineStackedPerMarker:
                {
                    if(type === c_oAscChartTypeSettings.lineNormal || type === c_oAscChartTypeSettings.lineNormalMarker)
                        need_groupping = GROUPING_STANDARD;
                    else if(type === c_oAscChartTypeSettings.lineStacked || type === c_oAscChartTypeSettings.lineStackedMarker)
                        need_groupping = GROUPING_STACKED;
                    else
                        need_groupping = GROUPING_PERCENT_STACKED;

                    if(type === c_oAscChartTypeSettings.lineNormal || type === c_oAscChartTypeSettings.lineStacked
                        || type === c_oAscChartTypeSettings.lineNormalMarker || type === c_oAscChartTypeSettings.lineStackedMarker)
                        need_num_fmt = "General";
                    else
                        need_num_fmt = "0%";

                    var b_marker = type ===  c_oAscChartTypeSettings.lineNormalMarker|| type === c_oAscChartTypeSettings.lineStackedMarker || type === c_oAscChartTypeSettings.lineStackedPerMarker;

                    if(chart_type.getObjectType() === historyitem_type_LineChart)
                    {
                        if(chart_type.grouping !== need_groupping)
                            chart_type.setGrouping(need_groupping);
                        val_axis = chart_type.getAxisByTypes().valAx;
                        for(i = 0; i < val_axis.length; ++i)
                        {
                            if(val_axis[i].numFmt.formatCode !== need_num_fmt)
                                val_axis[i].numFmt.setFormatCode(need_num_fmt);
                        }

                        if(chart_type.marker !== b_marker)
                            chart_type.setMarker(b_marker);
                    }
                    else
                    {
                        new_chart_type = new CLineChart();
                        replaceChart(plot_area, chart_type, new_chart_type);
                        checkSwapAxis(plot_area, chart_type, new_chart_type);
                        val_axis = new_chart_type.getAxisByTypes().valAx;
                        for(i = 0; i < val_axis.length; ++i)
                        {
                            if(val_axis[i].numFmt.formatCode !== need_num_fmt)
                                val_axis[i].numFmt.setFormatCode(need_num_fmt);
                        }
                        new_chart_type.setMarker(b_marker);
                        new_chart_type.setGrouping(need_groupping);
                    }
                    break;
                }
                case c_oAscChartTypeSettings.pie:
                {
                    if(chart_type.getObjectType() !== historyitem_type_PieChart)
                    {
                        new_chart_type = new CPieChart();
                        replaceChart(plot_area, chart_type, new_chart_type)
                        new_chart_type.setVaryColors(true);
                    }
                    break;
                }
                case c_oAscChartTypeSettings.doughnut:
                {
                    if(chart_type.getObjectType() !== historyitem_type_DoughnutChart)
                    {
                        new_chart_type = new CDoughnutChart();
                        replaceChart(plot_area, chart_type, new_chart_type)
                        new_chart_type.setVaryColors(true);
                        new_chart_type.setHoleSize(50);
                    }
                    break;
                }
                case c_oAscChartTypeSettings.areaNormal:
                case c_oAscChartTypeSettings.areaStacked:
                case c_oAscChartTypeSettings.areaStackedPer:
                {

                    if(type === c_oAscChartTypeSettings.areaNormal)
                        need_groupping = GROUPING_STANDARD;
                    else if(type === c_oAscChartTypeSettings.areaStacked)
                        need_groupping = GROUPING_STACKED;
                    else
                        need_groupping = GROUPING_PERCENT_STACKED;

                    if(type === c_oAscChartTypeSettings.areaNormal || type === c_oAscChartTypeSettings.areaStacked)
                        need_num_fmt = "General";
                    else
                        need_num_fmt = "0%";

                    if(chart_type.getObjectType() === historyitem_type_AreaChart)
                    {
                        if(chart_type.grouping !== need_groupping)
                            chart_type.setGrouping(need_groupping);
                        val_axis = chart_type.getAxisByTypes().valAx;
                        for(i = 0; i < val_axis.length; ++i)
                        {
                            if(val_axis[i].numFmt.formatCode !== need_num_fmt)
                                val_axis[i].numFmt.setFormatCode(need_num_fmt);
                        }
                    }
                    else
                    {
                        new_chart_type = new CAreaChart();
                        replaceChart(plot_area, chart_type, new_chart_type);
                        checkSwapAxis(plot_area, chart_type, new_chart_type);

                        val_axis = new_chart_type.getAxisByTypes().valAx;
                        for(i = 0; i < val_axis.length; ++i)
                        {
                            if(val_axis[i].numFmt.formatCode !== need_num_fmt)
                                val_axis[i].numFmt.setFormatCode(need_num_fmt);
                        }
                        new_chart_type.setGrouping(need_groupping);
                    }
                    break;
                }
                case c_oAscChartTypeSettings.scatter:
                case c_oAscChartTypeSettings.scatterLine:
                case c_oAscChartTypeSettings.scatterSmooth:
                {
                    if(chart_type.getObjectType() === historyitem_type_ScatterChart)
                    {
                    }
                    else
                    {
                        new_chart_type = new CScatterChart();
                        plot_area.addChart(new_chart_type, 0);
                        plot_area.removeCharts(1, plot_area.charts.length - 1);
                        new_chart_type.setFromOtherChart(chart_type);
                        axis_obj = CreateScatterAxis(); //cat - 0, val - 1
                        new_chart_type.addAxId(axis_obj.catAx);
                        new_chart_type.addAxId(axis_obj.valAx);
                    }
                    break;
                }
            }

            chart_type = plot_area.charts[0];
            //подписи данных
            if(typeof chart_type.setDLbls === "function")
            {
                var data_lbls;
                var checkDataLabels = function(chartType)
                {
                    chartType.removeDataLabels();
                    if(!chartType.dLbls)
                        chartType.setDLbls(new CDLbls());
                    return chartType.dLbls;
                }
                if(isRealBool(chartSettings.showCatName))
                    checkDataLabels(chart_type).setShowCatName(chartSettings.showCatName);
                if(isRealBool(chartSettings.showSerName))
                    checkDataLabels(chart_type).setShowSerName(chartSettings.showSerName);
                if(isRealBool(chartSettings.showVal))
                    checkDataLabels(chart_type).setShowVal(chartSettings.showVal);

                if(typeof chartSettings.separator === "string" && chartSettings.separator.length > 0)
                    checkDataLabels(chart_type).setSeparator(chartSettings.separator);
            }



            if(chart_type.getAxisByTypes )
            {
                axis_by_types = chart_type.getAxisByTypes();
                if(axis_by_types.catAx.length > 0 && axis_by_types.valAx.length > 0)
                {
                    cat_ax = axis_by_types.catAx[0];
                    val_ax = axis_by_types.valAx[0];
                }

                var scaling;
                var vert_axis_props = chartSettings.getVertAxisProps();
                if(vert_axis_props)
                {
                    if(!val_ax.scaling)
                        val_ax.setScaling(new CScaling());

                    scaling = val_ax.scaling;
                    if(isRealNumber(vert_axis_props.minValRule))
                    {
                        if(vert_axis_props.minValRule === c_oAscValAxisRule.auto)
                        {
                            if(isRealNumber(scaling.min))
                                scaling.setMin(null);
                        }
                        else
                        {
                            if(isRealNumber(vert_axis_props.minVal))
                                scaling.setMin(vert_axis_props.minVal);
                        }
                    }

                    if(isRealNumber(vert_axis_props.maxValRule))
                    {
                        if(vert_axis_props.maxValRule === c_oAscValAxisRule.auto)
                        {
                            if(isRealNumber(scaling.max))
                                scaling.setMax(null);
                        }
                        else
                        {
                            if(isRealNumber(vert_axis_props.maxVal))
                                scaling.setMax(vert_axis_props.maxVal);
                        }
                    }

                    if(isRealBool(vert_axis_props.invertValOrder))
                        scaling.setOrientation(vert_axis_props.invertValOrder ? ORIENTATION_MAX_MIN : ORIENTATION_MIN_MAX);


                    if(isRealBool(vert_axis_props.logScale) && isRealNumber(vert_axis_props.logBase) && vert_axis_props.logBase > 0)
                        scaling.setLogBase(vert_axis_props.logBase);

                    if(isRealNumber(vert_axis_props.units))
                    {
                        if(vert_axis_props.units === c_oAscValAxUnits.none)
                        {
                            if(val_ax.dispUnits)
                                val_ax.setDispUnits(null);
                        }
                        else if(isRealNumber(MENU_SETTINGS_MAP[vert_axis_props.units]))
                        {
                            if(!val_ax.dispUnits)
                                val_ax.setDispUnits(new CDispUnits());
                            val_ax.dispUnits.setBuiltInUnit(MENU_SETTINGS_MAP[vert_axis_props.units]);
                            if(isRealBool(val_ax.showUnitsOnChart))
                                val_ax.dispUnits.setDispUnitsLbl(new CDLbl());
                        }
                    }

                    if(isRealNumber(vert_axis_props.majorTickMark) && isRealNumber(MENU_SETTINGS_TICK_MARK[vert_axis_props.majorTickMark]))
                        val_ax.setMajorTickMark(MENU_SETTINGS_TICK_MARK[vert_axis_props.majorTickMark]);

                    if(isRealNumber(vert_axis_props.minorTickMark) && isRealNumber(MENU_SETTINGS_TICK_MARK[vert_axis_props.minorTickMark]))
                        val_ax.setMinorTickMark(MENU_SETTINGS_TICK_MARK[vert_axis_props.minorTickMark]);

                    if(isRealNumber(vert_axis_props.tickLabelsPos) && isRealNumber(MENU_SETTINGS_LABELS_POS[vert_axis_props.tickLabelsPos]))
                        val_ax.setTickLblPos(MENU_SETTINGS_LABELS_POS[vert_axis_props.tickLabelsPos]);

                    if(isRealNumber(vert_axis_props.crossesRule) && isRealObject(val_ax.crossAx))
                    {
                        if(vert_axis_props.crossesRule === c_oAscCrossesRule.auto)
                        {
                            val_ax.crossAx.setCrossesAt(null)
                            val_ax.crossAx.setCrosses(CROSSES_AUTO_ZERO);
                        }
                        else if(vert_axis_props.crossesRule === c_oAscCrossesRule.value)
                        {
                            if(isRealNumber(vert_axis_props.crosses))
                            {
                                val_ax.crossAx.setCrossesAt(vert_axis_props.crosses)
                                val_ax.crossAx.setCrosses(null);
                            }
                        }
                        else if(vert_axis_props.crossesRule === c_oAscCrossesRule.maxValue)
                        {
                            val_ax.crossAx.setCrossesAt(null)
                            val_ax.crossAx.setCrosses(CROSSES_MAX);
                        }
                    }

                    var hor_axis_props = chartSettings.getHorAxisProps();
                    if(hor_axis_props)
                    {
                        var  intervalBetweenTick       = hor_axis_props.getIntervalBetweenTick();
                        var  intervalBetweenLabelsRule = hor_axis_props.getIntervalBetweenLabelsRule();
                        var  intervalBetweenLabels     = hor_axis_props.getIntervalBetweenLabels();
                        var  invertCatOrder            = hor_axis_props.getInvertCatOrder();
                        var  labelsAxisDistance        = hor_axis_props.getLabelsAxisDistance();
                        var  axisType                  = hor_axis_props.getAxisType();
                        var  majorTickMark             = hor_axis_props.getMajorTickMark();
                        var  minorTickMark             = hor_axis_props.getMinorTickMark();
                        var  tickLabelsPos             = hor_axis_props.getTickLabelsPos();
                        var  crossesRule               = hor_axis_props.getCrossesRule();
                        var  crosses                   = hor_axis_props.getCrosses();
                        var  labelsPosition            = hor_axis_props.getLabelsPosition();


                        if(isRealNumber(intervalBetweenTick))
                            cat_ax.setTickMarkSkip(intervalBetweenTick);

                        if(isRealNumber(intervalBetweenLabelsRule))
                        {
                            if(intervalBetweenLabelsRule === c_oAscBetweenLabelsRule.auto)
                            {
                                if(isRealNumber(cat_ax.tickLblSkip))
                                {
                                    cat_ax.setTickLblSkip(null);
                                }
                            }
                            else if(intervalBetweenLabelsRule === c_oAscBetweenLabelsRule.manual && isRealNumber(intervalBetweenLabels))
                            {
                                cat_ax.setTickLblSkip(intervalBetweenLabels);
                            }
                        }

                        if(!cat_ax.scaling)
                            cat_ax.setScaling(new CScaling());
                        scaling = cat_ax.scaling;
                        if(isRealBool(invertCatOrder))
                            scaling.setOrientation(invertCatOrder ? ORIENTATION_MAX_MIN : ORIENTATION_MIN_MAX);
                        if(isRealNumber(labelsAxisDistance))
                            cat_ax.setLblOffset(labelsAxisDistance);

                        if(isRealNumber(axisType))
                        {
                            //TODO
                        }


                        if(isRealNumber(majorTickMark) && isRealNumber(MENU_SETTINGS_TICK_MARK[majorTickMark]))
                            cat_ax.setMajorTickMark(MENU_SETTINGS_TICK_MARK[majorTickMark]);

                        if(isRealNumber(minorTickMark) && isRealNumber(MENU_SETTINGS_TICK_MARK[minorTickMark]))
                            cat_ax.setMinorTickMark(MENU_SETTINGS_TICK_MARK[minorTickMark]);

                        if(isRealNumber(tickLabelsPos) && isRealNumber(MENU_SETTINGS_LABELS_POS[tickLabelsPos]))
                            cat_ax.setTickLblPos(MENU_SETTINGS_LABELS_POS[tickLabelsPos]);


                        if(isRealNumber(crossesRule) && isRealObject(cat_ax.crossAx))
                        {
                            if(crossesRule === c_oAscCrossesRule.auto)
                            {
                                cat_ax.crossAx.setCrossesAt(null)
                                cat_ax.crossAx.setCrosses(CROSSES_AUTO_ZERO);
                            }
                            else if(crossesRule === c_oAscCrossesRule.value)
                            {
                                if(isRealNumber(crosses))
                                {
                                    cat_ax.crossAx.setCrossesAt(crosses)
                                    cat_ax.crossAx.setCrosses(null);
                                }
                            }
                            else if(crossesRule === c_oAscCrossesRule.maxValue)
                            {
                                cat_ax.crossAx.setCrossesAt(null)
                                cat_ax.crossAx.setCrosses(CROSSES_MAX);
                            }
                        }

                        if(isRealNumber(labelsPosition) && isRealObject(cat_ax.crossAx))
                            cat_ax.crossAx(labelsPosition === c_oAscLabelsPosition.byDivisions ? CROSS_BETWEEN_MID_CAT : CROSS_BETWEEN_BETWEEN)
                    }
                }
            }

            chart_space.addToRecalculate();  //TODO
            chart_space.setRecalculateInfo();//TODO: обязательно переделать
            this.startRecalculate();
        }
    },


    getChartSpace: function(chart, options)
    {
        switch (chart.type)
        {
            case "Line":
            {
                switch (chart.subType.toLowerCase())
                {
                    case "normal":
                    {
                        return CreateLineChart(chart, GROUPING_STANDARD);
                    }
                    case "stacked":
                    {
                        return CreateLineChart(chart, GROUPING_STACKED);
                    }
                    case "stackedper":
                    {
                        return CreateLineChart(chart, GROUPING_PERCENT_STACKED);
                    }
                }
                break;
            }
            case "Bar":
            {
                switch (chart.subType.toLowerCase())
                {
                    case "normal":
                    {
                        return CreateBarChart(chart, BAR_GROUPING_CLUSTERED);
                    }
                    case "stacked":
                    {
                        return CreateBarChart(chart, BAR_GROUPING_STACKED);
                    }
                    case "stackedper":
                    {
                        return CreateBarChart(chart, BAR_GROUPING_PERCENT_STACKED);
                    }
                }
                break;
            }
            case "HBar":
            {
                switch(chart.subType.toLowerCase())
                {
                    case "normal":
                    {
                        return CreateHBarChart(chart, BAR_GROUPING_CLUSTERED);
                    }
                    case "stacked":
                    {
                        return CreateHBarChart(chart, BAR_GROUPING_STACKED);
                    }
                    case "stackedper":
                    {
                        return CreateHBarChart(chart, BAR_GROUPING_PERCENT_STACKED);
                    }
                }
                break;
            }
            case "Area":
            {
                switch(chart.subType.toLowerCase())
                {
                    case "normal":
                    {
                        return CreateAreaChart(chart, GROUPING_STANDARD);
                    }
                    case "stacked":
                    {
                        return CreateAreaChart(chart, GROUPING_STACKED);
                    }
                    case "stackedper":
                    {
                        return CreateAreaChart(chart, GROUPING_PERCENT_STACKED);
                    }
                }
                break;
            }
            case "Pie":
            case "Doughnut":
            {
                return CreatePieChart(chart, chart.type === "Doughnut");
            }
            case "Scatter":
            {
                return CreateScatterChart(chart);
            }
            case "Stock":
            {
                return CreateStockChart(chart);
            }
            case "Radar":
            {
                return CreateRadarChart(chart);
            }
        }
        return null;
    },

    changeCurrentState: function(newState)
    {
        this.curState = newState;
    },

    recalculateCurPos: function()
    {
        if(this.curState.textObject && this.curState.textObject.recalculateCurPos)
            this.curState.textObject.recalculateCurPos();
    },

    updateSelectionState: function()
    {
        if(isRealObject(this.curState.textObject))
        {
            this.curState.textObject.updateSelectionState(this.drawingObjects.drawingDocument);
        }
        else
        {
            this.drawingObjects.drawingDocument.UpdateTargetTransform(null);
            this.drawingObjects.drawingDocument.TargetEnd();
            this.drawingObjects.drawingDocument.SelectEnabled(false);
            this.drawingObjects.drawingDocument.SelectClear();
            this.drawingObjects.drawingDocument.SelectShow();
        }
    },

    remove: function(dir)
    {
        this.checkSelectedObjectsAndCallback(this.removeCallback, [dir]);
    },

    removeCallback: function(dir)
    {
		return;
        var state = this.curState;
        var drawingObjectsController = this;
        switch(state.id)
        {
            case STATES_ID_TEXT_ADD:
            case STATES_ID_TEXT_ADD_IN_GROUP:
            case STATES_ID_CHART_TEXT_ADD:
            case STATES_ID_CHART_TEXT_GROUP:
            {
                History.Create_NewPoint();
                var state = drawingObjectsController.curState;
                state.textObject.remove(dir, true);
                state.textObject.updateSelectionState(drawingObjectsController.drawingObjects.drawingDocument);
                break;
            }
            case STATES_ID_CHART:
            case STATES_ID_CHART_GROUP:
            {
                History.Create_NewPoint();
                var chart = state.chart;
                var history_is_on = History.Is_On();
                if(chart.chartTitle && chart.chartTitle.selected)
                {
                    if(history_is_on)
                        History.TurnOff();
                    g_oTableId.m_bTurnOff = true;
                    var copy_asc_chart = new asc_CChart(chart.chart);
                    g_oTableId.m_bTurnOff = false;
                    copy_asc_chart.header.asc_setTitle("");
                    if(history_is_on)
                        History.TurnOn();
                    chart.setChart(copy_asc_chart);
                    History.TurnOn();
                }
                else if(chart.hAxisTitle && chart.hAxisTitle.selected)
                {
                    if(history_is_on)
                        History.TurnOff();
                    g_oTableId.m_bTurnOff = true;
                    var copy_asc_chart = new asc_CChart(chart.chart);
                    g_oTableId.m_bTurnOff = false;
                    copy_asc_chart.xAxis.asc_setTitle("");
                    if(history_is_on)
                        History.TurnOn();
                    chart.setChart(copy_asc_chart);
                }
                else if(chart.vAxisTitle && chart.vAxisTitle.selected)
                {
                    if(history_is_on)
                        History.TurnOff();
                    g_oTableId.m_bTurnOff = true;
                    var copy_asc_chart = new asc_CChart(chart.chart);
                    g_oTableId.m_bTurnOff = false;
                    copy_asc_chart.yAxis.asc_setTitle("");
                    if(history_is_on)
                        History.TurnOn();
                    chart.setChart(copy_asc_chart);
                }
                chart.recalculate();
                break;
            }
            case STATES_ID_GROUP:
            {
                History.Create_NewPoint();
                var state = drawingObjectsController.curState;
                var group = state.group;
                var selected_objects = [];
                for(var i = 0; i < group.selectedObjects.length; ++i)
                {
                    selected_objects.push(group.selectedObjects[i]);
                }
                group.resetSelection();
                drawingObjectsController.resetSelectionState2();
                History.Add(g_oUndoRedoGraphicObjects, historyitem_AutoShapes_GroupRecalculateUndo, null, null,
                    new UndoRedoDataGraphicObjects(group.Id, new UndoRedoDataGOSingleProp(null, null)), null);
                var groups = [];
                for(i = 0; i < selected_objects.length; ++i)
                {
                    var parent_group = selected_objects[i].group;
                    parent_group.removeFromSpTree(selected_objects[i].Get_Id());
                    for(var j = 0; j < groups.length; ++j)
                    {
                        if(groups[i] === parent_group)
                            break;
                    }
                    if(j === groups.length)
                        groups.push(parent_group);
                }
                groups.sort(CompareGroups);
                for(i  = 0; i < groups.length; ++i)
                {
                    var parent_group = groups[i];
                    if(parent_group !== group)
                    {
                        if(parent_group.spTree.length === 0)
                        {
                            parent_group.group.removeFromSpTree(parent_group.Get_Id());
                        }
                        if(parent_group.spTree.length === 1)
                        {
                            var sp = parent_group.spTree[0];
                            sp.setRotate(normalizeRotate(isRealNumber(sp.spPr.xfrm.rot) ? sp.spPr.xfrm.rot : 0 + isRealNumber(parent_group.spPr.xfrm.rot) ? parent_group.spPr.xfrm.rot : 0 ));
                            sp.setFlips(sp.spPr.xfrm.flipH === true ? !(parent_group.spPr.xfrm.flipH === true) : parent_group.spPr.xfrm.flipH === true,
                                sp.spPr.xfrm.flipV === true ? !(parent_group.spPr.xfrm.flipV === true) : parent_group.spPr.xfrm.flipV === true);
                            sp.setPosition(sp.spPr.xfrm.x + parent_group.spPr.xfrm.x, sp.spPr.xfrm.y + parent_group.spPr.xfrm.y);
                            parent_group.group.swapGraphicObject(parent_group.Get_Id(), sp.Get_Id());
                        }
                    }
                    else
                    {
                        switch (parent_group.spTree.length)
                        {
                            case 0:
                            {
                                parent_group.deleteDrawingBase();
                                break;
                            }
                            case 1:
                            {
                                var sp = parent_group.spTree[0];
                                sp.setRotate(normalizeRotate(isRealNumber(sp.spPr.xfrm.rot) ? sp.spPr.xfrm.rot : 0 + isRealNumber(parent_group.spPr.xfrm.rot) ? parent_group.spPr.xfrm.rot : 0 ));
                                sp.setFlips(sp.spPr.xfrm.flipH === true ? !(parent_group.spPr.xfrm.flipH === true) : parent_group.spPr.xfrm.flipH === true,
                                    sp.spPr.xfrm.flipV === true ? !(parent_group.spPr.xfrm.flipV === true) : parent_group.spPr.xfrm.flipV === true);
                                sp.setPosition(sp.spPr.xfrm.offX + parent_group.spPr.xfrm.offX, sp.spPr.xfrm.offY + parent_group.spPr.xfrm.offY);
                                sp.setGroup(null);
                                var pos = parent_group.deleteDrawingBase();
                                sp.addToDrawingObjects(pos);
                                sp.select(drawingObjectsController);
                                sp.recalculateTransform();
                                sp.calculateTransformTextMatrix();

                                drawingObjectsController.updateSelectionState(drawingObjectsController.drawingObjects.drawingDocument);
                                History.Add(g_oUndoRedoGraphicObjects, historyitem_AutoShapes_RecalculateTransformRedo, null, null,
                                    new UndoRedoDataGraphicObjects(sp.Id, new UndoRedoDataGOSingleProp(null, null)), null);
                                break;
                            }
                            default:
                            {
                                parent_group.normalize();
                                parent_group.updateCoordinatesAfterInternalResize();
                                parent_group.select(drawingObjectsController);
                                parent_group.recalculate();

                                drawingObjectsController.updateSelectionState(drawingObjectsController.drawingObjects.drawingDocument);
                                History.Add(g_oUndoRedoGraphicObjects, historyitem_AutoShapes_GroupRecalculateRedo, null, null,
                                    new UndoRedoDataGraphicObjects(parent_group.Id, new UndoRedoDataGOSingleProp(null, null)), null);
                                break;
                            }
                        }
                    }
                }
                break;
            }
            case STATES_ID_NULL:
            case STATES_ID_EXPECT_DOUBLE_CLICK:
            {
                // Если открыт iframe, то нельзя удалить диаграмму
                if ( drawingObjectsController.selectedObjects.length == 1 )
                {
                    if ( (typeof  CChartAsGroup != "undefined" && drawingObjectsController.selectedObjects[0] instanceof CChartAsGroup) && (drawingObjectsController.selectedObjects[0].chart.bChartEditor) )
                        break;
                }
                History.Create_NewPoint();
                this.bNoResetSeclectionState = true;
                for(var i = drawingObjectsController.selectedObjects.length-1; i > -1 ; --i)
                {
                    drawingObjectsController.selectedObjects[i].deleteDrawingBase();
                }
                this.bNoResetSeclectionState = false;
                drawingObjectsController.resetSelectionState2();
                drawingObjectsController.updateSelectionState(drawingObjectsController.drawingObjects.drawingDocument);
                break;
            }
            default :
            {
                break;
            }
        }

        drawingObjectsController.drawingObjects.showDrawingObjects(true);
    },


    onKeyDown: function(e)
    {
        return this.curState.onKeyDown(e);
    },

    /*onKeyPress: function(e)
    {
        this.curState.onKeyPress(e);
        return true;
    },*/

    resetSelectionState: function()
    {
        if(this.bNoResetSeclectionState === true)
            return;
        var count = this.selectedObjects.length;
        while(count > 0)
        {
            this.selectedObjects[0].deselect(this);
            --count;
        }
        this.changeCurrentState(new NullState(this, this.drawingObjects));
        this.updateSelectionState();
        var asc = window["Asc"] ? window["Asc"] : (window["Asc"] = {});
        asc["editor"].asc_endAddShape();
    },

    resetSelectionState2: function()
    {
        var count = this.selectedObjects.length;
        while(count > 0)
        {
            this.selectedObjects[0].deselect(this);
            --count;
        }
        this.changeCurrentState(new NullState(this, this.drawingObjects));


    },

    resetSelection: function()
    {
        var count = this.selectedObjects.length;
        while(count > 0)
        {
			var selected_object = this.selectedObjects[0];
			var old_group = selected_object.group;
			selected_object.group = null;
            this.selectedObjects[0].deselect(this);
			selected_object.group = old_group;
            --count;
        }
    },

    clearPreTrackObjects: function()
    {
        this.arrPreTrackObjects.length = 0;
    },

    addPreTrackObject: function(preTrackObject)
    {
        this.arrPreTrackObjects.push(preTrackObject);
    },

    clearTrackObjects: function()
    {
        this.arrTrackObjects.length = 0;
    },

    addTrackObject: function(trackObject)
    {
        this.arrTrackObjects.push(trackObject);
    },

    swapTrackObjects: function()
    {
        this.clearTrackObjects();
        for(var i = 0; i < this.arrPreTrackObjects.length; ++i)
            this.addTrackObject(this.arrPreTrackObjects[i]);
        this.clearPreTrackObjects();
    },

    getTrackObjects: function()
    {
        return this.arrTrackObjects;
    },

    rotateTrackObjects: function(angle, e)
    {
        for(var i = 0; i < this.arrTrackObjects.length; ++i)
            this.arrTrackObjects[i].track(angle, e);
    },

    trackNewShape: function(e, x, y)
    {
        this.arrTrackObjects[0].track(e, x, y);
        this.updateOverlay();
    },

    trackMoveObjects: function(dx, dy)
    {
        for(var i = 0; i < this.arrTrackObjects.length; ++i)
            this.arrTrackObjects[i].track(dx, dy);
    },

    trackResizeObjects: function(kd1, kd2, e)
    {
        for(var i = 0; i < this.arrTrackObjects.length; ++i)
            this.arrTrackObjects[i].track(kd1, kd2, e);
    },

    trackEnd: function()
    {
        for(var i = 0; i < this.arrTrackObjects.length; ++i)
            this.arrTrackObjects[i].trackEnd();
        this.drawingObjects.showDrawingObjects(true);
    },

    canGroup: function()
    {
        return this.getArrayForGrouping().length > 1;
    },

    getArrayForGrouping: function()
    {
        var graphic_objects = this.getDrawingObjects();
        var grouped_objects = [];
        for(var i = 0; i < graphic_objects.length; ++i)
        {
            var cur_graphic_object = graphic_objects[i];
            if(cur_graphic_object.selected && cur_graphic_object.canGroup())
            {
                grouped_objects.push(cur_graphic_object);
            }
        }
        return grouped_objects;
    },


    getGroup: function()
    {
        var grouped_objects = this.getArrayForGrouping();
        if(grouped_objects.length < 2)
            return null;
        var max_x, min_x, max_y, min_y;
        var bounds = grouped_objects[0].getBoundsInGroup();
        max_x = bounds.maxX;
        max_y = bounds.maxY;
        min_x = bounds.minX;
        min_y = bounds.minY;
        for(var i = 1; i < grouped_objects.length; ++i)
        {
            bounds = grouped_objects[i].getBoundsInGroup();
            if(max_x < bounds.maxX)
                max_x = bounds.maxX;
            if(max_y < bounds.maxY)
                max_y = bounds.maxY;
            if(min_x > bounds.minX)
                min_x = bounds.minX;
            if(min_y > bounds.minY)
                min_y = bounds.minY;
        }
        var group = new CGroupShape();
        group.setSpPr(new CSpPr());
        group.spPr.setParent(group);
        group.spPr.setXfrm(new CXfrm());
        var xfrm = group.spPr.xfrm;
        xfrm.setParent(group.spPr);
        xfrm.setOffX(min_x);
        xfrm.setOffY(min_y);
        xfrm.setExtX(max_x-min_x);
        xfrm.setExtY(max_y-min_y);
        xfrm.setChExtX(max_x-min_x);
        xfrm.setChExtY(max_y-min_y);
        xfrm.setChOffX(0);
        xfrm.setChOffY(0);
        for(i = 0; i < grouped_objects.length; ++i)
        {
            grouped_objects[i].spPr.xfrm.setOffX(grouped_objects[i].x - min_x);
            grouped_objects[i].spPr.xfrm.setOffY(grouped_objects[i].y - min_y);
            grouped_objects[i].setGroup(group);
            group.addToSpTree(group.spTree.length, grouped_objects[i]);
        }
        return group;
    },

    unGroup: function()
    {
        this.checkSelectedObjectsAndCallback(this.unGroupCallback, null)
    },

    unGroupCallback: function()
    {
        History.Create_NewPoint();
        if(isRealObject(this.curState.group) )
        {
            this.curState.group.resetSelection();
        }

        if(isRealObject(this.curState.chart) )
        {
            this.curState.chart.resetSelection();
        }
        var selected_objects = this.selectedObjects;
        var ungrouped_objects = [];
        for(var i = 0; i < selected_objects.length; ++i)
        {
            if(selected_objects[i].isGroup() && selected_objects[i].canUnGroup())
            {
                ungrouped_objects.push(selected_objects[i]);

            }
        }
        var drawing_bases = this.drawingObjects.getDrawingObjects();
        this.resetSelection();
        for(i = 0; i < ungrouped_objects.length; ++i)
        {
            var cur_group = ungrouped_objects[i];
            var start_position = null;
            for(var j = 0; j < drawing_bases.length; ++j)
            {
                if(drawing_bases[j].graphicObject === cur_group)
                {
                    start_position = j;
                    break;
                }
            }
            History.Add(g_oUndoRedoGraphicObjects, historyitem_AutoShapes_GroupRecalculateUndo, null, null,
                new UndoRedoDataGraphicObjects(ungrouped_objects[i].Get_Id(), new UndoRedoDataGOSingleProp(null, null)));
            cur_group.deleteDrawingBase();
            var ungrouped_sp_tree = ungrouped_objects[i].getUnGroupedSpTree();

            // Блокируем дочерние объекты
            var _this = this;
            this.drawingObjects.objectLocker.reset();

            var callbackUngroupedObjects = function (result) {
                if ( result ) {
                    for (var j = 0; j < ungrouped_sp_tree.length; ++j) {
                        ungrouped_sp_tree[j].recalculateTransform();
                        History.Add(g_oUndoRedoGraphicObjects, historyitem_AutoShapes_RecalculateTransformRedo, null, null, new UndoRedoDataGraphicObjects(ungrouped_sp_tree[j].Get_Id(), new UndoRedoDataGOSingleProp(null, null)));
                        ungrouped_sp_tree[j].addToDrawingObjects(start_position + j);
                        ungrouped_sp_tree[j].select(_this);

                    }
                }
            }

            for(var j = 0; j < ungrouped_sp_tree.length; ++j)
            {
                this.drawingObjects.objectLocker.addObjectId(ungrouped_sp_tree[j].Get_Id());
            }
            this.drawingObjects.objectLocker.checkObjects(callbackUngroupedObjects);
        }
        this.changeCurrentState(new NullState(this, this.drawingObjects));
        this.drawingObjects.OnUpdateOverlay();
    },

    canUnGroup: function()
    {
        for (var i = 0; i < this.selectedObjects.length; i++)
        {
            if (this.selectedObjects[i].isGroup())
                return true;
        }
        return false;
    },

    startTrackNewShape: function(presetGeom)
    {
        switch (presetGeom)
        {
            case "spline":
            {
                this.changeCurrentState(new SplineBezierState(this));
                break;
            }
            case "polyline1":
            {
                this.changeCurrentState(new PolyLineAddState(this));
                break;
            }
            case "polyline2":
            {
                this.changeCurrentState(new AddPolyLine2State(this));
                break;
            }
            default :
            {
                this.changeCurrentState(new StartTrackNewShapeState(this, presetGeom));
                break;
            }
        }
    },


    getHyperlinkInfo: function()
    {
        if(this.curState.id === STATES_ID_TEXT_ADD || this.curState.id === STATES_ID_TEXT_ADD_IN_GROUP)
        {
            return this.curState.textObject.txBody.content.Hyperlink_Check(false);
        }
        return null;
    },

    getSelectionState: function()
    {
        var state = {};
        return state;
        switch(this.curState.id)
        {
            case STATES_ID_TEXT_ADD:
            {
                state.id = STATES_ID_TEXT_ADD;
                state.textObjectId = this.curState.textObject.Get_Id();
                state.textState = this.curState.textObject.txBody.content.Get_SelectionState();
                state.selectedObjects = [];
                for(var i = 0; i < this.selectedObjects.length; ++i)
                {
                    state.selectedObjects.push(this.selectedObjects[i].Get_Id());
                }
                break;
            }
            case STATES_ID_GROUP:
            {
                state.id = STATES_ID_GROUP;
                state.groupId = this.curState.group.Get_Id();
                state.selectedObjects = [];
                for(var i = 0; i < this.curState.group.selectedObjects.length; ++i)
                {
                    state.selectedObjects.push(this.curState.group.selectedObjects[i].Get_Id());
                }
                break;
            }
            case STATES_ID_CHART_TEXT_ADD:
            {
                state.id = STATES_ID_CHART_TEXT_ADD;
                state.chart = this.curState.chart;
                state.textObjectId = this.curState.textObject.Get_Id();
                state.textState = this.curState.textObject.txBody.content.Get_SelectionState();
                state.selectedObjects = [];
                for(var i = 0; i < this.selectedObjects.length; ++i)
                {
                    state.selectedObjects.push(this.selectedObjects[i].Get_Id());
                }
                break;
            }
            case STATES_ID_CHART:
            {
                state.id = STATES_ID_CHART;
                state.chart = this.curState.chart;
                state.selectedTitle = null;
                var chart = this.curState.chart;
                if(chart.chartTitle && chart.chartTitle.selected)
                {
                    state.selectedTitle = chart.chartTitle;
                }
                else if(chart.hAxisTitle && chart.hAxisTitle.selected)
                {
                    state.selectedTitle = chart.hAxisTitle;
                }
                else if(chart.vAxisTitle && chart.vAxisTitle.selected)
                {
                    state.selectedTitle = chart.vAxisTitle;
                }
                state.selectedObjects = [];
                for(var i = 0; i < this.selectedObjects.length; ++i)
                {
                    state.selectedObjects.push(this.selectedObjects[i].Get_Id());
                }
                break;
            }
            case STATES_ID_TEXT_ADD_IN_GROUP:
            {
                state.id = STATES_ID_TEXT_ADD_IN_GROUP;
                state.group = this.curState.group;
                state.textObject = this.curState.textObject;
                state.textState = this.curState.textObject.txBody.content.Get_SelectionState();
                state.selectedObjects = [];
                for(var i = 0; i < this.selectedObjects.length; ++i)
                {
                    state.selectedObjects.push(this.selectedObjects[i].Get_Id());
                }
                break;
            }
            case STATES_ID_CHART_TEXT_GROUP:
            {
                state.id = STATES_ID_CHART_TEXT_GROUP;
                state.group = this.curState.group;
                state.chart = this.curState.chart;
                state.textObject = this.curState.textObject;
                state.textSelectionState = this.curState.textObject.txBody.content.Get_SelectionState();
                state.selectedObjects = [];
                for(var i = 0; i < this.selectedObjects.length; ++i)
                {
                    state.selectedObjects.push(this.selectedObjects[i].Get_Id());
                }
                break;
            }
            default :
            {
                if(this.curState.group && !this.curState.chart)
                {
                    state.id = STATES_ID_GROUP;
                    state.groupId = this.curState.group.Get_Id();
                    state.selectedObjects = [];
                    for(var i = 0; i < this.curState.group.selectedObjects.length; ++i)
                    {
                        state.selectedObjects.push(this.curState.group.selectedObjects[i].Get_Id());
                    }
                    break;
                }
                else if(!this.curState.group && this.curState.chart && this.curState.id !== STATES_ID_EXPECT_DOUBLE_CLICK)
                {
                    state.id = STATES_ID_CHART;
                    state.chart = this.curState.chart;
                    state.selectedTitle = null;
                    var chart = this.curState.chart;
                    if(chart.chartTitle && chart.chartTitle.selected)
                    {
                        state.selectedTitle = chart.chartTitle;
                    }
                    else if(chart.hAxisTitle && chart.hAxisTitle.selected)
                    {
                        state.selectedTitle = chart.hAxisTitle;
                    }
                    else if(chart.vAxisTitle && chart.vAxisTitle.selected)
                    {
                        state.selectedTitle = chart.vAxisTitle;
                    }
                    state.selectedObjects = [];
                    for(var i = 0; i < this.selectedObjects.length; ++i)
                    {
                        state.selectedObjects.push(this.selectedObjects[i].Get_Id());
                    }
                    break;
                }
                else if(this.curState.chart && this.curState.group)
                {
                    state.id = STATES_ID_CHART_GROUP;
                    state.chart = this.curState.chart;
                    state.group = this.curState.group;
                    state.selectedTitle = this.curState.chart.getSelectedTitle();
                    state.selectedObjects = [];
                    for(var i = 0; i < this.selectedObjects.length; ++i)
                    {
                        state.selectedObjects.push(this.selectedObjects[i].Get_Id());
                    }
                    break;
                }
                state.id = STATES_ID_NULL;
                state.selectedObjects = [];
                for(var i = 0; i < this.selectedObjects.length; ++i)
                {
                    state.selectedObjects.push(this.selectedObjects[i].Get_Id());
                }
                break;
            }
        }
        state.sheetId = this.drawingObjects.getWorksheet().model.getId();
        return state;
    },

    setSelectionState: function(state)
    {
        return;
        History.workbook.handlers.trigger("showWorksheet", state.sheetId);
        this.resetSelectionState2();
        switch(state.id)
        {
            case STATES_ID_TEXT_ADD:
            {
                var text_object = g_oTableId.Get_ById(state.textObjectId);
                text_object.select(this);
                text_object.txBody.content.Set_SelectionState(state.textState, state.textState.length - 1);
                this.changeCurrentState(new TextAddState(this, this.drawingObjects, text_object));
                break;
            }
            case STATES_ID_GROUP:
            {
                var group = g_oTableId.Get_ById(state.groupId);
                group.select(this);
                for(var i = 0; i < state.selectedObjects.length; ++i)
                {
                    g_oTableId.Get_ById(state.selectedObjects[i]).select(group);
                }
                this.changeCurrentState(new GroupState(this, this.drawingObjects, group));
                break;
            }
            case STATES_ID_CHART_TEXT_ADD:
            {
                state.chart.select(this);
                var text_title = g_oTableId.Get_ById(state.textObjectId);
                if(text_title)
                {
                    text_title.select()
                    text_title.txBody.content.Set_SelectionState(state.textState, state.textState.length - 1);
                }
                this.changeCurrentState(new ChartTextAdd(this, this.drawingObjects, state.chart, text_title));
                break;
            }
            case STATES_ID_CHART:
            {
                state.chart.select(this);
                if(state.selectedTitle)
                {
                    state.selectedTitle.select();
                }
                this.changeCurrentState(new ChartState(this, this.drawingObjects, state.chart));
                break;
            }
            case STATES_ID_TEXT_ADD_IN_GROUP:
            {
                state.group.select(this);
                state.textObject.select(this);
                state.textObject.txBody.content.Set_SelectionState(state.textState, state.textState.length - 1);
                this.changeCurrentState(new TextAddInGroup(this, this.drawingObjects, state.group, state.textObject));
                break;
            }
            case STATES_ID_CHART_TEXT_GROUP:
            {
                state.group.select(this);
                state.chart.select(this);
                state.textObject.select();
                state.textObject.txBody.content.Set_SelectionState(state.textSelectionState, state.textSelectionState.length - 1);
                this.changeCurrentState(new ChartTextAddGroup(this, this.drawingObjects, state.group, state.chart, state.textObject));
                break;
            }
            case STATES_ID_CHART_GROUP:
            {
                state.group.select(this);
                state.chart.select(this);
                if(state.selectedTitle)
                    state.selectedTitle.select();
                this.changeCurrentState(new ChartGroupState(this, this.drawingObjects, state.group, state.chart));
                break;
            }
            default :
            {
                for(var i = 0; i < state.selectedObjects.length; ++i)
                {
                    g_oTableId.Get_ById(state.selectedObjects[i]).select(this);
                }
                break;
            }
        }
        this.recalculateCurPos();
        this.updateSelectionState();
        return state;
    },

    drawTracks: function(overlay)
    {
        for(var i = 0; i < this.arrTrackObjects.length; ++i)
            this.arrTrackObjects[i].draw(overlay);
    },

    needUpdateOverlay: function()
    {
        return this.arrTrackObjects.length > 0;
    },

    drawSelection: function(drawingDocument)
    {
        this.curState.drawSelection(drawingDocument);
    },

    drawTextSelection: function()
    {
        if(isRealObject(this.curState.textObject) )
        {
            this.curState.textObject.drawTextSelection();
        }
    },

    getSelectedObjects: function()
    {
        return this.selectedObjects;
    },

    getGraphicObjectProps: function()
    {
        var api = window["Asc"]["editor"];
        var shape_props, image_props, chart_props;
        var ascSelectedObjects = [];

        // Основные свойства объекта
        if(isRealObject(this.curState.group))
        {
            var selected_objects = this.curState.group.selectedObjects;
            for(var i = 0; i< selected_objects.length; ++i)
            {
                var c_obj = selected_objects[i];
                if(c_obj.isImage())
                {
                    if(!isRealObject(image_props))
                    {
                        image_props = new asc_CImgProperty();
                        image_props.fromGroup = true;
                        image_props.ImageUrl = c_obj.getImageUrl();
                    }
                    else
                    {
                        if(image_props.ImageUrl != null && c_obj.getImageUrl() !== image_props.ImageUrl)
                            image_props.ImageUrl = null;
                    }
                }
                if(c_obj.isChart())
                {
                    if(!isRealObject(chart_props))
                    {
                        chart_props = new asc_CImgProperty();

                        chart_props.fromGroup = true;
                        chart_props.ChartProperties = new asc_CChart(c_obj.chart);
                    }
                    else
                    {
                        chart_props.chart = null;
                        chart_props.severalCharts = true;
                        if(chart_props.severalChartTypes !== true)
                        {
                            if(!(chart_props.ChartProperties.type === c_obj.chart.type && chart_props.ChartProperties.subType === c_obj.chart.subType) )
                                chart_props.severalChartTypes = true;
                        }
                        if(chart_props.severalChartStyles !== true)
                        {
                            if(chart_props.ChartProperties.styleId !== c_obj.chart.styleId )
                                chart_props.severalChartStyles = true;
                        }
                    }
                }
                if(c_obj.isShape())
                {
                    if(!isRealObject(shape_props))
                    {
                        shape_props = new asc_CImgProperty();

                        shape_props.fromGroup = true;
                        shape_props.ShapeProperties = new asc_CShapeProperty();
                        shape_props.ShapeProperties.type = c_obj.getPresetGeom();
                        shape_props.ShapeProperties.fill = c_obj.getFill();
                        shape_props.ShapeProperties.stroke = c_obj.getStroke();
                        shape_props.ShapeProperties.canChangeArrows = c_obj.canChangeArrows();
                        shape_props.ShapeProperties.paddings = c_obj.getPaddings();
                        shape_props.verticalTextAlign = isRealObject(c_obj.txBody) ? c_obj.txBody.getBodyPr().anchor : null;
                        shape_props.ShapeProperties.canFill = c_obj.canFill();
                    }
                    else
                    {
                        var ShapeProperties =
                        {
                            type: c_obj.getPresetGeom(),
                            fill: c_obj.getFill(),
                            stroke: c_obj.getStroke(),
                            canChangeArrows: c_obj.canChangeArrows(),
                            paddings: c_obj.getPaddings(),
                            canFill: c_obj.canFill()
                        };
                        shape_props.ShapeProperties = CompareShapeProperties(ShapeProperties, shape_props.ShapeProperties);
                        shape_props.verticalTextAlign = undefined;
                    }
                }
            }
        }
        else
        {
            var s_arr = this.selectedObjects;
            for(i = 0; i < s_arr.length; ++i)
            {
                c_obj = s_arr[i];
                if (isRealObject(c_obj))
                {
                    if (c_obj.isShape())
                    {
                        if (!isRealObject(shape_props))
                        {
                            shape_props = {};
                            shape_props =  c_obj.Get_Props(null);
                            shape_props.ShapeProperties = new asc_CShapeProperty();

                            shape_props.ShapeProperties.type = c_obj.getPresetGeom();
                            shape_props.ShapeProperties.fill = c_obj.getFill();
                            shape_props.ShapeProperties.stroke = c_obj.getStroke();
                            shape_props.ShapeProperties.canChangeArrows = c_obj.canChangeArrows();
                            shape_props.ShapeProperties.paddings = c_obj.getPaddings();
                            shape_props.ShapeProperties.IsLocked = !(c_obj.lockType === c_oAscLockTypes.kLockTypeNone || c_obj.lockType === c_oAscLockTypes.kLockTypeNone);
                            shape_props.verticalTextAlign = isRealObject(c_obj.txBody) ? c_obj.txBody.getBodyPr().anchor : null;
                            shape_props.ShapeProperties.canFill = c_obj.canFill();

                        }
                        else
                        {
                            ShapeProperties = new asc_CShapeProperty();
                            ShapeProperties.type = c_obj.getPresetGeom();
                            ShapeProperties.fill = c_obj.getFill();
                            ShapeProperties.stroke = c_obj.getStroke();
                            ShapeProperties.canChangeArrows = c_obj.canChangeArrows();
                            ShapeProperties.paddings = c_obj.getPaddings();
                            ShapeProperties.IsLocked = !(c_obj.lockType === c_oAscLockTypes.kLockTypeNone || c_obj.lockType === c_oAscLockTypes.kLockTypeNone);
                            ShapeProperties.canFill = c_obj.canFill();

                            shape_props =  c_obj.Get_Props(shape_props);
                            shape_props.ShapeProperties = CompareShapeProperties(ShapeProperties, shape_props.ShapeProperties);
                            shape_props.verticalTextAlign = undefined;
                        }
                    }
                    if (c_obj.isImage())
                    {
                        if (!isRealObject(image_props))
                        {
                            image_props = new asc_CImgProperty();
                            image_props.Width = c_obj.extX;
                            image_props.Height = c_obj.extY;
                            image_props.ImageUrl = c_obj.getImageUrl();
                            image_props.IsLocked = !(c_obj.lockType === c_oAscLockTypes.kLockTypeNone || c_obj.lockType === c_oAscLockTypes.kLockTypeNone);
                        }
                        else
                        {
                            var locked = !(c_obj.lockType === c_oAscLockTypes.kLockTypeNone|| c_obj.lockType === c_oAscLockTypes.kLockTypeNone) || image_props.IsLocked;
                            image_props = c_obj.Get_Props(image_props);
                            if (image_props.ImageUrl != null && c_obj.getImageUrl() !== image_props.ImageUrl)
                                image_props.ImageUrl = null;
                            image_props.IsLocked = locked;

                        }
                    }
                    if (c_obj.isChart())
                    {
                        if (!isRealObject(chart_props))
                        {
                            chart_props = new asc_CImgProperty();
                            chart_props.Width = c_obj.extX;
                            chart_props.Height = c_obj.extY;
                            chart_props.ChartProperties = new asc_CChart(c_obj.chart);
                        }
                    }
                    if (c_obj.isGroup())
                    {
                        var shape_props2 = c_obj.getShapeProps();
                        var image_props2 = c_obj.getImageProps2();
                        var chart_props2 = c_obj.getChartProps();
                        if(isRealObject(shape_props2))
                        {
                            if (!isRealObject(shape_props))
                            {
                                shape_props = {};
                                shape_props =  s_arr[i].Get_Props(null);
                                shape_props.ShapeProperties = shape_props2.ShapeProperties;
                            }
                            else
                            {
                                shape_props =  s_arr[i].Get_Props(shape_props);
                                shape_props.ShapeProperties = CompareShapeProperties(shape_props2.ShapeProperties, shape_props.ShapeProperties);
                            }
                        }

                        if (isRealObject(image_props2))
                        {
                            if(!isRealObject(image_props))
                            {
                                image_props = {};
                                image_props = s_arr[i].Get_Props(null);
                                image_props.ImageUrl = image_props2.ImageUrl;
                            }
                            else
                            {
                                image_props = s_arr[i].Get_Props(image_props);
                                if(image_props.ImageUrl != null && image_props2.ImageUrl !== image_props.ImageUrl)
                                    image_props.ImageUrl = null;
                            }
                        }
                        if (isRealObject(chart_props2))
                        {
                            if (!isRealObject(chart_props))
                            {
                                chart_props = {};
                                chart_props = s_arr[i].Get_Props(null);
                                chart_props.ChartProperties = chart_props2.ChartProperties;
                                chart_props.severalCharts = chart_props2.severalCharts;
                                chart_props.severalChartTypes = chart_props2.severalChartTypes;
                                chart_props.severalChartStyles = chart_props2.severalChartStyles;
                            }
                            else
                            {
                                chart_props = s_arr[i].Get_Props(chart_props);
                                chart_props.severalCharts = true;
                                if(chart_props.severalChartTypes !== true)
                                {
                                    if(chart_props2.severalChartTypes === true)
                                        chart_props.severalChartTypes = true;
                                    else
                                    {
                                        if(!(chart_props.ChartProperties.type === chart_props2.ChartProperties.type && chart_props.ChartProperties.subType === chart_props2.ChartProperties.subType) )
                                            chart_props.severalChartTypes = true;
                                        if(chart_props.ChartProperties.subType !== chart_props2.ChartProperties.subType  )
                                            chart_props.severalChartStyles = true;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        var ret = [];
        if (isRealObject(shape_props))
        {
            if (shape_props.ShapeProperties)
            {
                var pr = shape_props.ShapeProperties;
                if (pr.fill != null && pr.fill.fill != null && pr.fill.fill.type == FILL_TYPE_BLIP)
                {
                    if(asc && asc["editor"])
                        this.drawingObjects.drawingDocument.InitGuiCanvasShape(asc["editor"].shapeElementId)
                    this.drawingObjects.drawingDocument.DrawImageTextureFillShape(pr.fill.fill.RasterImageId);
                }
                else
                {
                    if(asc && asc["editor"])
                        this.drawingObjects.drawingDocument.InitGuiCanvasShape(asc["editor"].shapeElementId)
                    this.drawingObjects.drawingDocument.DrawImageTextureFillShape(null);
                }
                shape_props.ShapeProperties.fill = CreateAscFillEx(shape_props.ShapeProperties.fill);
                shape_props.ShapeProperties.stroke = CreateAscStrokeEx(shape_props.ShapeProperties.stroke);
                shape_props.ShapeProperties.stroke.canChangeArrows  = shape_props.ShapeProperties.canChangeArrows === true;
            }
            else
            {
                this.drawingObjects.drawingDocument.DrawImageTextureFillShape(null);
            }

            ret.push(shape_props);
        }

        if (isRealObject(image_props))
        {
            ret.push(image_props);
        }

        if (isRealObject(chart_props))
        {
            ret.push(chart_props);
        }

        for (var i = 0; i < ret.length; i++) {

            if ( api.chartStyleManager && api.chartPreviewManage && (!api.chartStyleManager.isReady() || !api.chartPreviewManager.isReady()) && ret[i].ChartProperties ) {
                api.chartStyleManager.init();
                api.chartPreviewManager.init();
                this.drawingObjects.callTrigger("asc_onUpdateChartStyles");
            }
            ascSelectedObjects.push(new asc_CSelectedObject( c_oAscTypeSelectElement.Image, new asc_CImgProperty(ret[i]) ));
        }

        // Текстовые свойства объекта
        var ParaPr = this.getParagraphParaPr();
        var TextPr = this.getParagraphTextPr();
        if ( ParaPr && TextPr ) {
            this.prepareParagraphProperties(ParaPr, TextPr);
        }

        return ascSelectedObjects;
    },

    prepareParagraphProperties: function(ParaPr, TextPr)
    {
        var _this = this;
        var trigger = this.drawingObjects.callTrigger;

        ParaPr.Subscript   = ( TextPr.VertAlign === vertalign_SubScript   ? true : false );
        ParaPr.Superscript = ( TextPr.VertAlign === vertalign_SuperScript ? true : false );
        ParaPr.Strikeout   = TextPr.Strikeout;
        ParaPr.DStrikeout  = TextPr.DStrikeout;
        ParaPr.AllCaps     = TextPr.Caps;
        ParaPr.SmallCaps   = TextPr.SmallCaps;
        ParaPr.TextSpacing = TextPr.Spacing;
        ParaPr.Position    = TextPr.Position;
        //-----------------------------------------------------------------------------

        if ( true === ParaPr.Spacing.AfterAutoSpacing )
            ParaPr.Spacing.After = spacing_Auto;
        else if ( undefined === ParaPr.Spacing.AfterAutoSpacing )
            ParaPr.Spacing.After = UnknownValue;

        if ( true === ParaPr.Spacing.BeforeAutoSpacing )
            ParaPr.Spacing.Before = spacing_Auto;
        else if ( undefined === ParaPr.Spacing.BeforeAutoSpacing )
            ParaPr.Spacing.Before = UnknownValue;

        if ( -1 === ParaPr.PStyle )
            ParaPr.StyleName = "";

        if ( null == ParaPr.NumPr || 0 === ParaPr.NumPr.NumId )
            ParaPr.ListType = {Type: -1, SubType : -1};

        // ParaPr.Spacing
        if ( true === ParaPr.Spacing.AfterAutoSpacing )
            ParaPr.Spacing.After = spacing_Auto;
        else if ( undefined === ParaPr.Spacing.AfterAutoSpacing )
            ParaPr.Spacing.After = UnknownValue;

        if ( true === ParaPr.Spacing.BeforeAutoSpacing )
            ParaPr.Spacing.Before = spacing_Auto;
        else if ( undefined === ParaPr.Spacing.BeforeAutoSpacing )
            ParaPr.Spacing.Before = UnknownValue;

        trigger("asc_onParaSpacingLine", new asc_CParagraphSpacing( ParaPr.Spacing ));

        // ParaPr.Jc
        trigger("asc_onPrAlign", ParaPr.Jc);

        ascSelectedObjects.push(new asc_CSelectedObject( c_oAscTypeSelectElement.Paragraph, new asc_CParagraphProperty( ParaPr ) ));
    },

    createImage: function(rasterImageId, x, y, extX, extY)
	{
		var image = new CImageShape();
		image.setSpPr(new CSpPr());
		image.spPr.setParent(image);
		image.spPr.setGeometry(CreateGeometry("rect"));
		image.spPr.setXfrm(new CXfrm());
		image.spPr.xfrm.setParent(image.spPr);
		image.spPr.xfrm.setOffX(x);
		image.spPr.xfrm.setOffY(y);
		image.spPr.xfrm.setExtX(extX);
		image.spPr.xfrm.setExtY(extY);
		image.setBlipFill(new CBlipFill());
		image.blipFill.setRasterImageId(rasterImageId);
		image.blipFill.setStretch(true);
		image.setNvPicPr(new UniNvPr());
		return image;
	},
	
	Get_SelectedText: function()
    {
        if(this.curState.textObject && this.curState.textObject.Get_SelectedText)
        {
            return this.curState.textObject.Get_SelectedText();
        }
    },

    putPrLineSpacing: function(type, value)
    {
    },

    putPrLineSpacingCallback: function(type, value)
    {
        switch (this.curState.id)
        {
            case STATES_ID_TEXT_ADD:
            case STATES_ID_TEXT_ADD_IN_GROUP:
            {
                var spacing = new CParaSpacing();
                var _type;
                switch(type)
                {
                    case 0:
                    {
                        _type = linerule_AtLeast;
                        break;
                    }
                    case 1:
                    {
                        _type = linerule_Auto;
                        break;
                    }
                    case 2:
                    {
                        _type = linerule_Exact;
                        break;
                    }
                }
                var spacing = new CParaSpacing();
                spacing.LineRule = _type;
                spacing.Line = value;
                this.curState.textObject.txBody.content.Set_ParagraphSpacing(spacing);
                break;
            }
            case STATES_ID_NULL:
            {
                if(editor.WordControl.m_oLogicDocument.Document_Is_SelectionLocked(changestype_Text_Props) === false)
                {
                    for(var i = 0; i < this.selectedObjects.length; ++i)
                    {
                        if(typeof this.selectedObjects[i].applyAllSpacing === "function")
                        {
                            this.selectedObjects[i].applyAllSpacing(val);
                        }
                    }
                }
                break;
            }
        }
    },

    putLineSpacingBeforeAfter: function(type, value)
    {
    },



    setGraphicObjectProps: function(props)
    {
        this.checkSelectedObjectsAndCallback(this.setGraphicObjectPropsCallBack, [props])
    },

    checkSelectedObjectsAndCallback: function(callback, args)
    {

        var selection_state = this.getSelectionState();
        this.drawingObjects.objectLocker.reset();
        for(var i = 0; i < this.selectedObjects.length; ++i)
        {
            this.drawingObjects.objectLocker.addObjectId(this.selectedObjects[i].Get_Id());
        }
        var _this = this;
        var callback2 = function(bLock)
        {
            if(bLock)
            {
                _this.setSelectionState(selection_state);
                callback.apply(_this, args);
                _this.recalculateCurPos();

            }
        };
        this.drawingObjects.objectLocker.checkObjects(callback2);
    },

    setGraphicObjectPropsCallBack: function(props)
    {

        History.Create_NewPoint();
        var properties;
        if ( (props instanceof asc_CImgProperty) && props.ShapeProperties )
            properties = props.ShapeProperties;
        else
            properties = props;

        if (isRealObject(properties) || isRealObject(props))
        {
            if (isRealObject(props) && typeof props.verticalTextAlign === "number" && !isNaN(props.verticalTextAlign))
            {
                if (this.curState.id === STATES_ID_TEXT_ADD)
                {
                    if(typeof this.curState.textObject.setCellVertAlign === "function")
                        this.curState.textObject.setCellVertAlign(props.verticalTextAlign);
                }

                if (this.curState.id === STATES_ID_TEXT_ADD_IN_GROUP)
                {
                    if (typeof this.curState.textObject.setCellVertAlign === "function")
                        this.curState.textObject.setCellVertAlign(props.verticalTextAlign);
                }
            }
            if ( !(this.curState.id === STATES_ID_GROUP || this.curState.id === STATES_ID_TEXT_ADD_IN_GROUP) )
            {
                var ArrGlyph = this.selectedObjects;
                for (var i = 0;  i< ArrGlyph.length; ++i)
                {
                    if ( undefined != properties.Width || undefined != properties.Height )
                    {
                        var result_width, result_height;
                        var b_is_line = ArrGlyph[i].checkLine();
                        if (properties.Width != undefined)
                            if (properties.Width >= MIN_SHAPE_SIZE || b_is_line)
                                result_width = properties.Width;
                            else
                                result_width = MIN_SHAPE_SIZE;
                        else
                            result_width = ArrGlyph[i].extX;

                        if (properties.Height != undefined)
                            if(properties.Height >= MIN_SHAPE_SIZE || b_is_line)
                                result_height = properties.Height;
                            else
                                result_height = MIN_SHAPE_SIZE;
                        else
                            result_height = ArrGlyph[i].extY;

                        if (ArrGlyph[i].isShape() || ArrGlyph[i].isImage())
                        {
                            History.Add(g_oUndoRedoGraphicObjects, historyitem_AutoShapes_RecalculateTransformUndo, null, null, new UndoRedoDataGraphicObjects(ArrGlyph[i].Id, new UndoRedoDataShapeRecalc()), null);
                            ArrGlyph[i].setExtents(result_width, result_height);
                            ArrGlyph[i].setXfrm(null, null, result_width, result_height, null, null, null);
                            ArrGlyph[i].recalculateTransform();
                            ArrGlyph[i].calculateContent();
                            ArrGlyph[i].calculateTransformTextMatrix();
                            History.Add(g_oUndoRedoGraphicObjects, historyitem_AutoShapes_RecalculateTransformRedo, null, null, new UndoRedoDataGraphicObjects(ArrGlyph[i].Id, new UndoRedoDataShapeRecalc()), null);

                        }
                        else if (ArrGlyph[i].isChart())
                        {
                            History.Add(g_oUndoRedoGraphicObjects, historyitem_AutoShapes_RecalculateTransformUndo, null, null, new UndoRedoDataGraphicObjects(ArrGlyph[i].Id, new UndoRedoDataShapeRecalc()), null);
                            ArrGlyph[i].setExtents(result_width, result_height);
                            ArrGlyph[i].recalculate();
                            History.Add(g_oUndoRedoGraphicObjects, historyitem_AutoShapes_RecalculateTransformRedo, null, null, new UndoRedoDataGraphicObjects(ArrGlyph[i].Id, new UndoRedoDataShapeRecalc()), null);

                        }
                    }

                    else if (ArrGlyph[i].isImage() && typeof props.ImageUrl === "string")
                    {
                        ArrGlyph[i].setRasterImage(props.ImageUrl);
                    }

                    else if (((ArrGlyph[i].isShape()) || (ArrGlyph[i].isGroup())))
                    {
                        if (properties.type != undefined && properties.type != -1)
                        {
                            ArrGlyph[i].changePresetGeometry(properties.type);
                        }
                        if (properties.fill)
                        {
                            ArrGlyph[i].changeFill(properties.fill);
                        }
                        if (properties.stroke)
                        {
                            ArrGlyph[i].changeLine(properties.stroke);
                        }
                        if(properties.paddings)
                        {
                            ArrGlyph[i].setPaddings(properties.paddings);
                        }
                    }

                    if (typeof props.verticalTextAlign === "number" && !isNaN(props.verticalTextAlign) && typeof ArrGlyph[i].setTextVerticalAlign === "function")
                    {
                        ArrGlyph[i].setTextVerticalAlign(props.verticalTextAlign);
                    }
                    if(ArrGlyph[i].isChart() && isRealObject(props.ChartProperties))
                    {
                        ArrGlyph[i].setChart(props.ChartProperties);
                        ArrGlyph[i].recalculate();
                    }

                }
            }
            else if (this.curState.id === STATES_ID_GROUP || this.curState.id === STATES_ID_TEXT_ADD_IN_GROUP)
            {
                //if (false === this.document.Document_Is_SelectionLocked(changestype_Drawing_Props, {Type : changestype_2_Element_and_Type , Element : this.curState.group.parent.Parent, CheckType : changestype_Paragraph_Content} ))
                {
                    ArrGlyph = this.curState.group.selectedObjects;
                    for (i = 0;  i< ArrGlyph.length; ++i)
                    {
                        if (ArrGlyph[i].isShape() && isRealObject(properties))
                        {
                            if (properties.type != undefined && properties.type != -1)
                            {
                                ArrGlyph[i].changePresetGeometry(properties.type);
                            }
                            if (properties.fill)
                            {
                                ArrGlyph[i].changeFill(properties.fill);
                            }
                            if (properties.stroke)
                            {
                                ArrGlyph[i].changeLine(properties.stroke);
                            }
                            if(properties.paddings)
                            {
                                ArrGlyph[i].setPaddings(properties.paddings);
                            }
                        }
                        else if (isRealObject(props) && typeof  props.ImageUrl === "string" && ArrGlyph[i].isImage())
                        {
                            ArrGlyph[i].setRasterImage(props.ImageUrl);
                        }

                        if (typeof props.verticalTextAlign === "number" && !isNaN(props.verticalTextAlign) && typeof ArrGlyph[i].setTextVerticalAlign === "function")
                        {
                            ArrGlyph[i].setCellAllVertAlign(props.verticalTextAlign);
                        }
                    }
                }
            }
        }
        if(props instanceof asc_CParagraphProperty)
        {
            // TODO: Сделать так, чтобы пересчет был всего 1 здесь
            //   if ( "undefined" != typeof(Props.ContextualSpacing) && null != Props.ContextualSpacing )
            //       this.WordControl.m_oLogicDocument.Set_ParagraphContextualSpacing( Props.ContextualSpacing );

            var  Props = props;
            if ( "undefined" != typeof(Props.Ind) && null != Props.Ind )
                this.setPargarphIndent( Props.Ind );

            if ( "undefined" != typeof(Props.Jc) && null != Props.Jc )
                this.setCellAlign( Props.Jc );

            //  if ( "undefined" != typeof(Props.KeepLines) && null != Props.KeepLines )
            //      this.WordControl.m_oLogicDocument.Set_ParagraphKeepLines( Props.KeepLines );

            //if ( undefined != Props.KeepNext && null != Props.KeepNext )
            //    this.WordControl.m_oLogicDocument.Set_ParagraphKeepNext( Props.KeepNext );

            //if ( undefined != Props.WidowControl && null != Props.WidowControl )
            //    this.WordControl.m_oLogicDocument.Set_ParagraphWidowControl( Props.WidowControl );

            //  if ( "undefined" != typeof(Props.PageBreakBefore) && null != Props.PageBreakBefore )
            //      this.WordControl.m_oLogicDocument.Set_ParagraphPageBreakBefore( Props.PageBreakBefore );

            if ( "undefined" != typeof(Props.Spacing) && null != Props.Spacing )
                this.setPargarphSpacing( Props.Spacing );

            //  if ( "undefined" != typeof(Props.Shd) && null != Props.Shd )
            //      this.WordControl.m_oLogicDocument.Set_ParagraphShd( Props.Shd );

            //   if ( "undefined" != typeof(Props.Brd) && null != Props.Brd )
            //       this.WordControl.m_oLogicDocument.Set_ParagraphBorders( Props.Brd );

            if ( undefined != Props.Tabs )
            {
                var Tabs = new CParaTabs();
                Tabs.Set_FromObject( Props.Tabs.Tabs );
                this.setPargaraphTabs( Tabs );
            }

            //  if ( undefined != Props.DefaultTab )
            //  {
            //      this.WordControl.m_oLogicDocument.Set_DocumentDefaultTab( Props.DefaultTab );
            //  }


            // TODO: как только разъединят настройки параграфа и текста переделать тут
            var TextPr = new CTextPr();

            if ( true === Props.Subscript )
                TextPr.VertAlign = vertalign_SubScript;
            else if ( true === Props.Superscript )
                TextPr.VertAlign = vertalign_SuperScript;
            else if ( false === Props.Superscript || false === Props.Subscript )
                TextPr.VertAlign = vertalign_Baseline;

            if ( undefined != Props.Strikeout )
            {
                TextPr.Strikeout  = Props.Strikeout;
                TextPr.DStrikeout = false;
            }

            if ( undefined != Props.DStrikeout )
            {
                TextPr.DStrikeout = Props.DStrikeout;
                if ( true === TextPr.DStrikeout )
                    TextPr.Strikeout = false;
            }

            if ( undefined != Props.SmallCaps )
            {
                TextPr.SmallCaps = Props.SmallCaps;
                TextPr.AllCaps   = false;
            }

            if ( undefined != Props.AllCaps )
            {
                TextPr.Caps = Props.AllCaps;
                if ( true === TextPr.AllCaps )
                    TextPr.SmallCaps = false;
            }

            if ( undefined != Props.TextSpacing )
                TextPr.Spacing = Props.TextSpacing;

            if ( undefined != Props.Position )
                TextPr.Position = Props.Position;

            this.paragraphAdd(new ParaTextPr(TextPr), false);
        }
        this.drawingObjects.showDrawingObjects(true);
        this.drawingObjects.sendGraphicObjectProps();
    },

    paragraphAdd: function(paraItem, bRecalculate)
    {
        var cur_state  = this.curState;
        if(cur_state.id === STATES_ID_TEXT_ADD || cur_state.id === STATES_ID_TEXT_ADD_IN_GROUP)
        {
            cur_state.textObject.paragraphAdd(paraItem, bRecalculate);
        }
        else
        {
            if(cur_state.id === STATES_ID_NULL)
            {
                var selected_array = this.selectedObjects;
                if(paraItem.Type === para_TextPr)
                {
                    for(var sel_index = 0; sel_index < selected_array.length; ++sel_index)
                    {
                        selected_array[sel_index].applyTextPr(paraItem, bRecalculate);
                    }
                }
				else
				{
					if(this.selectedObjects.length === 1 && this.selectedObjects[0].isShape())
					{
						var shape = this.selectedObjects[0];
						if(!shape.textBody)
						{
							shape.createTextBody();
						}
						shape.paragraphAdd(paraItem, bRecalculate);
						this.changeCurrentState(new TextAddState(this, shape));
						this.updateSelectionState();
						return;
					}
				}
            }
            else if(cur_state.id === STATES_ID_GROUP)
            {
                selected_array = cur_state.group.selectedObjects;
                if(paraItem.Type === para_TextPr)
                {
                    for(sel_index = 0; sel_index < selected_array.length; ++sel_index)
                    {
                        if(typeof selected_array[sel_index].applyTextPr === "function")
                            selected_array[sel_index].applyTextPr(paraItem, bRecalculate);
                    }
                }
            }
            else if(cur_state.id === STATES_ID_CHART_TEXT_ADD)
            {
                cur_state.title.paragraphAdd(paraItem, bRecalculate);
            }
        }
    },

    applyColorScheme: function()
    {
        var aObjects = this.drawingObjects.getDrawingObjects();
        for (var i = 0; i < aObjects.length; i++)
        {
            if(typeof aObjects[i].graphicObject.recalculateColors === "function")
                aObjects[i].graphicObject.recalculateColors();
        }
    },

    // layers
    setGraphicObjectLayer: function(layerType)
    {
        this.checkSelectedObjectsAndCallback(this.setGraphicObjectLayerCallBack, [layerType]);
        //oAscDrawingLayerType
    },


    setGraphicObjectLayerCallBack: function(layerType)
    {
        if(!(this.curState.group instanceof CGroupShape))
        {
            History.Create_NewPoint();
            switch (layerType)
            {
                case 0:
                {
                    this.bringToFront();
                    break;
                }
                case 1:
                {
                    this.sendToBack();
                    break;
                }
                case 2:
                {
                    this.bringForward();
                    break;
                }
                case 3:
                {
                    this.bringBackward();
                }
            }
        }
        else
        {
            var oThis = this;
            var callback = function(layer)
            {
                History.Create_NewPoint();
                switch (layer)
                {
                    case 0:
                    {
                        oThis.bringToFront();
                        break;
                    }
                    case 1:
                    {
                        oThis.sendToBack();
                        break;
                    }
                    case 2:
                    {
                        oThis.bringForward();
                        break;
                    }
                    case 3:
                    {
                        oThis.bringBackward();
                    }
                }
            };
            this.checkSelectedObjectsAndCallback(callback, [layerType]);
        }

    },



    bringToFront : function()
    {
        var state = this.curState;
        var sp_tree = this.drawingObjects.getDrawingObjects();
        if(!(state.group instanceof CGroupShape))
        {
            var selected = [];
            for(var i = 0; i < sp_tree.length; ++i)
            {
                if(sp_tree[i].graphicObject.selected)
                {
                    selected.push(sp_tree[i].graphicObject);
                }
            }
            for(var i = sp_tree.length-1; i > -1 ; --i)
            {
                if(sp_tree[i].graphicObject.selected)
                {
                    sp_tree[i].graphicObject.deleteDrawingBase();
                }
            }
            for(i = 0; i < selected.length; ++i)
            {
                selected[i].addToDrawingObjects(sp_tree.length);
            }
        }
        else
        {
            state.group.bringToFront();
        }
        this.drawingObjects.showDrawingObjects(true);

    },

    bringForward : function()
    {
        var state = this.curState;
        var sp_tree = this.drawingObjects.getDrawingObjects();
        if(!(state.group instanceof CGroupShape))
        {
            for(var i = sp_tree.length - 1;i > -1; --i)
            {
                var sp = sp_tree[i].graphicObject;
                if(sp.selected && i < sp_tree.length - 1 && !sp_tree[i+1].graphicObject.selected)
                {
                    sp.deleteDrawingBase();
                    sp.addToDrawingObjects(i+1);
                }
            }
        }
        else
        {
            state.group.bringForward();
        }
        this.drawingObjects.showDrawingObjects(true);
    },

    sendToBack : function()
    {
        var state = this.curState;
        var sp_tree = this.drawingObjects.getDrawingObjects();

        if(!(state.group instanceof CGroupShape))
        {
            var  j = 0;
            for(var i = 0; i < sp_tree.length; ++i)
            {
                if(sp_tree[i].graphicObject.selected)
                {
                    var object = sp_tree[i].graphicObject;
                    object.deleteDrawingBase();
                    object.addToDrawingObjects(j);
                    ++j;
                }
            }
        }
        else
        {
            state.group.sendToBack();
        }
        this.drawingObjects.showDrawingObjects(true);

    },


    bringBackward : function()
    {
        var state = this.curState;
        var sp_tree = this.drawingObjects.getDrawingObjects();
        if(!(state.group instanceof CGroupShape))
        {
            for(var i = 0;i < sp_tree.length; ++i)
            {
                var sp = sp_tree[i].graphicObject;
                if(sp.selected && i > 0 && !sp_tree[i-1].graphicObject.selected)
                {
                    sp.deleteDrawingBase();
                    sp.addToDrawingObjects(i-1);
                }
            }
        }
        else
        {
            state.group.bringBackward();
        }
        this.drawingObjects.showDrawingObjects(true);

    }
};


//-----------------------------------------------------------------------------------
// ASC Classes
//-----------------------------------------------------------------------------------

function asc_CColor() {
    this.type = c_oAscColor.COLOR_TYPE_SRGB;
    this.value = null;
    this.r = 0;
    this.g = 0;
    this.b = 0;
    this.a = 255;

    this.Mods = [];
    this.ColorSchemeId = -1;
}

asc_CColor.prototype = {
    asc_getR: function() { return this.r },
    asc_putR: function(v) { this.r = v; this.hex = undefined; },
    asc_getG: function() { return this.g; },
    asc_putG: function(v) { this.g = v; this.hex = undefined; },
    asc_getB: function() { return this.b; },
    asc_putB: function(v) { this.b = v; this.hex = undefined; },
    asc_getA: function() { return this.a; },
    asc_putA: function(v) { this.a = v; this.hex = undefined; },
    asc_getType: function() { return this.type; },
    asc_putType: function(v) { this.type = v; },
    asc_getValue: function() { return this.value; },
    asc_putValue: function(v) { this.value = v; },
    asc_getHex: function() {
        if(!this.hex)
        {
            var a = this.a.toString(16);
            var r = this.r.toString(16);
            var g = this.g.toString(16);
            var b = this.b.toString(16);
            this.hex = ( a.length == 1? "0" + a: a) +
                ( r.length == 1? "0" + r: r) +
                ( g.length == 1? "0" + g: g) +
                ( b.length == 1? "0" + b: b);
        }
        return this.hex;
    },
    asc_getColor: function() {
        var ret = new CColor(this.r, this.g, this.b);
        return ret;
    }
}

//{ asc_CColor export
window["Asc"].asc_CColor = asc_CColor;
window["Asc"]["asc_CColor"] = asc_CColor;
prot = asc_CColor.prototype;

prot["asc_getR"] = prot.asc_getR;
prot["asc_putR"] = prot.asc_putR;
prot["asc_getG"] = prot.asc_getG;
prot["asc_putG"] = prot.asc_putG;
prot["asc_getB"] = prot.asc_getB;
prot["asc_putB"] = prot.asc_putB;
prot["asc_getA"] = prot.asc_getA;
prot["asc_putA"] = prot.asc_putA;
prot["asc_getType"] = prot.asc_getType;
prot["asc_putType"] = prot.asc_putType;
prot["asc_getValue"] = prot.asc_getValue;
prot["asc_putValue"] = prot.asc_putValue;
prot["asc_getHex"] = prot.asc_getHex;
prot["asc_getColor"] = prot.asc_getColor;
//}

function CreateAscColorCustomEx(r, g, b) {
    var ret = new asc_CColor();
    ret.type = c_oAscColor.COLOR_TYPE_SRGB;
    ret.r = r;
    ret.g = g;
    ret.b = b;
    ret.a = 255;
    return ret;
}

function CreateAscColorEx(unicolor) {
    if (null == unicolor || null == unicolor.color)
        return new asc_CColor();

    var ret = new asc_CColor();
    ret.r = unicolor.RGBA.R;
    ret.g = unicolor.RGBA.G;
    ret.b = unicolor.RGBA.B;
    ret.a = unicolor.RGBA.A;

    var _color = unicolor.color;
    switch (_color.type)
    {
        case COLOR_TYPE_SRGB:
        case COLOR_TYPE_SYS:
        {
            break;
        }
        case COLOR_TYPE_PRST:
        {
            ret.type = c_oAscColor.COLOR_TYPE_PRST;
            ret.value = _color.id;
            break;
        }
        case COLOR_TYPE_SCHEME:
        {
            ret.type = c_oAscColor.COLOR_TYPE_SCHEME;
            ret.value = _color.id;
            break;
        }
        default:
            break;
    }
    return ret;
}

function CorrectUniColorEx(asc_color, unicolor) {
    if (null == asc_color)
        return unicolor;

    var ret = unicolor;
    if (null == ret)
        ret = new CUniColor();

    var _type = asc_color.asc_getType();
    switch (_type)
    {
        case c_oAscColor.COLOR_TYPE_PRST:
        {
            if (ret.color == null || ret.color.type != COLOR_TYPE_PRST)
            {
                ret.setColor(new CPrstColor());
            }
            ret.color.id = asc_color.asc_getValue();
            break;
        }
        case c_oAscColor.COLOR_TYPE_SCHEME:
        {
            if (ret.color == null || ret.color.type != COLOR_TYPE_SCHEME)
            {
                ret.setColor(new CSchemeColor());
            }

            // тут выставляется ТОЛЬКО из меню. поэтому:
            var _index = parseInt(asc_color.asc_getValue());
            var _id = (_index / 6) >> 0;
            var _pos = _index - _id * 6;

            var array_colors_types = [6, 15, 7, 16, 0, 1, 2, 3, 4, 5];
            ret.color.setColorId(array_colors_types[_id]);

            if (ret.Mods.Mods.length != 0)
                ret.Mods.Mods.splice(0, ret.Mods.Mods.length);

            var __mods = g_oThemeColorsDefaultMods;

            var _editor = window["Asc"]["editor"];
            if (_editor && _editor.wbModel)
            {
                var _theme = _editor.wbModel.theme;
                var _clrMap = _editor.wbModel.clrSchemeMap;

                if (_theme && _clrMap)
                {
                    var _schemeClr = new CSchemeColor();
                    _schemeClr.id = array_colors_types[_id];

                    var _rgba = {R:0, G:0, B:0, A:255};
                    _schemeClr.Calculate(_theme, _clrMap.color_map, _rgba);

                    var __r = _schemeClr.RGBA.R;
                    var __g = _schemeClr.RGBA.G;
                    var __b = _schemeClr.RGBA.B;

                    if (__r > 200 && __g > 200 && __b > 200)
                        __mods = g_oThemeColorsDefaultMods1;
                    else if (__r < 40 && __g < 40 && __b < 40)
                        __mods = g_oThemeColorsDefaultMods2;
                }
            }

            if (1 <= _pos && _pos <= 5)
            {
                var _mods = __mods[_pos - 1];
                var _ind = 0;
                for (var k in _mods)
                {
                    var mod = new CColorMod();
                    mod.setName(k);
                    mod.setVal(_mods[k]);
                    ret.addMod(mod);
                    _ind++;
                }
            }

            break;
        }
        default:
        {
            if (ret.color == null || ret.color.type != COLOR_TYPE_SRGB)
            {
                ret.setColor(new CRGBColor());
            }
            ret.color.setColor(((asc_color.asc_getR() << 16) & 0xFF0000) + ((asc_color.asc_getG() << 8) & 0xFF00) + asc_color.asc_getB());
            ret.clearMods();
        }
    }
    return ret;
}

function asc_CShapeFill() {
    this.type = null;
    this.fill = null;
    this.transparent = null;
}

asc_CShapeFill.prototype = {
    asc_getType: function() { return this.type; },
    asc_putType: function(v) { this.type = v; },
    asc_getFill: function() { return this.fill; },
    asc_putFill: function(v) { this.fill = v; },
    asc_getTransparent: function() { return this.transparent; },
    asc_putTransparent: function(v) { this.transparent = v; }
}

//{ asc_CShapeFill export
window["Asc"].asc_CShapeFill = asc_CShapeFill;
window["Asc"]["asc_CShapeFill"] = asc_CShapeFill;
prot = asc_CShapeFill.prototype;

prot["asc_getType"] = prot.asc_getType;
prot["asc_putType"] = prot.asc_putType;

prot["asc_getFill"] = prot.asc_getFill;
prot["asc_putFill"] = prot.asc_putFill;

prot["asc_getTransparent"] = prot.asc_getTransparent;
prot["asc_putTransparent"] = prot.asc_putTransparent;
//}

function asc_CFillBlip() {
    this.type = c_oAscFillBlipType.STRETCH;
    this.url = "";
    this.texture_id = null;
}

asc_CFillBlip.prototype = {
    asc_getType: function(){return this.type},
    asc_putType: function(v){this.type = v;},
    asc_getUrl: function(){return this.url;},
    asc_putUrl: function(v){this.url = v;},
    asc_getTextureId: function(){return this.texture_id;},
    asc_putTextureId: function(v){this.texture_id = v;}
}

//{ asc_CFillBlip export
window["Asc"].asc_CFillBlip = asc_CFillBlip;
window["Asc"]["asc_CFillBlip"] = asc_CFillBlip;
prot = asc_CFillBlip.prototype;

prot["asc_getType"] = prot.asc_getType;
prot["asc_putType"] = prot.asc_putType;

prot["asc_getUrl"] = prot.asc_getUrl;
prot["asc_putUrl"] = prot.asc_putUrl;

prot["asc_getTextureId"] = prot.asc_getTextureId;
prot["asc_putTextureId"] = prot.asc_putTextureId;
//}

function asc_CFillHatch() {
    this.PatternType = undefined;
    this.fgClr = undefined;
    this.bgClr = undefined;
}

asc_CFillHatch.prototype = {
    asc_getPatternType: function(){return this.PatternType;},
    asc_putPatternType: function(v){this.PatternType = v;},
    asc_getColorFg: function(){return this.fgClr;},
    asc_putColorFg: function(v){this.fgClr = v;},
    asc_getColorBg: function(){return this.bgClr;},
    asc_putColorBg: function(v){this.bgClr = v;}
}

//{ asc_CFillHatch export
window["Asc"].asc_CFillHatch = asc_CFillHatch;
window["Asc"]["asc_CFillHatch"] = asc_CFillHatch;
prot = asc_CFillHatch.prototype;

prot["asc_getPatternType"] = prot.asc_getPatternType;
prot["asc_putPatternType"] = prot.asc_putPatternType;

prot["asc_getColorFg"] = prot.asc_getColorFg;
prot["asc_putColorFg"] = prot.asc_putColorFg;

prot["asc_getColorBg"] = prot.asc_getColorBg;
prot["asc_putColorBg"] = prot.asc_putColorBg;
//}

function asc_CFillGrad() {
    this.Colors = undefined;
    this.Positions = undefined;
    this.GradType = 0;

    this.LinearAngle = undefined;
    this.LinearScale = true;

    this.PathType = 0;
}

asc_CFillGrad.prototype = {
    asc_getColors: function(){return this.Colors;},
    asc_putColors: function(v){this.Colors = v;},
    asc_getPositions: function(){return this.Positions;},
    asc_putPositions: function(v){this.Positions = v;},
    asc_getGradType: function(){return this.GradType;},
    asc_putGradType: function(v){this.GradType = v;},
    asc_getLinearAngle: function(){return this.LinearAngle;},
    asc_putLinearAngle: function(v){this.LinearAngle = v;},
    asc_getLinearScale: function(){return this.LinearScale;},
    asc_putLinearScale: function(v){this.LinearScale = v;},
    asc_getPathType: function(){return this.PathType;},
    asc_putPathType: function(v){this.PathType = v;}
}

//{ asc_CFillGrad export
window["Asc"].asc_CFillGrad = asc_CFillGrad;
window["Asc"]["asc_CFillGrad"] = asc_CFillGrad;
prot = asc_CFillGrad.prototype;

prot["asc_getColors"] = prot.asc_getColors;
prot["asc_putColors"] = prot.asc_putColors;
prot["asc_getPositions"] = prot.asc_getPositions;
prot["asc_putPositions"] = prot.asc_putPositions;
prot["asc_getGradType"] = prot.asc_getGradType;
prot["asc_putGradType"] = prot.asc_putGradType;
prot["asc_getLinearAngle"] = prot.asc_getLinearAngle;
prot["asc_putLinearAngle"] = prot.asc_putLinearAngle;
prot["asc_getLinearScale"] = prot.asc_getLinearScale;
prot["asc_putLinearScale"] = prot.asc_putLinearScale;
prot["asc_getPathType"] = prot.asc_getPathType;
prot["asc_putPathType"] = prot.asc_putPathType;
//}

function asc_CFillSolid() {
    this.color = new CAscColor();
}

asc_CFillSolid.prototype = {
    asc_getColor: function() { return this.color },
    asc_putColor: function(v) { this.color = v; }
}

//{ asc_CFillSolid export
window["Asc"].asc_CFillSolid = asc_CFillSolid;
window["Asc"]["asc_CFillSolid"] = asc_CFillSolid;
prot = asc_CFillSolid.prototype;

prot["asc_getColor"] = prot.asc_getColor;
prot["asc_putColor"] = prot.asc_putColor;
//}

function CreateAscFillEx(unifill) {
    if (null == unifill || null == unifill.fill)
        return new asc_CShapeFill();

    var ret = new asc_CShapeFill();

    var _fill = unifill.fill;
    switch (_fill.type)
    {
        case FILL_TYPE_SOLID:
        {
            ret.type = c_oAscFill.FILL_TYPE_SOLID;
            ret.fill = new asc_CFillSolid();
            ret.fill.color = CreateAscColorEx(_fill.color);
            break;
        }
        case FILL_TYPE_PATT:
        {
            ret.type = c_oAscFill.FILL_TYPE_PATT;
            ret.fill = new asc_CFillHatch();
            ret.fill.PatternType = _fill.ftype;
            ret.fill.fgClr = CreateAscColorEx(_fill.fgClr);
            ret.fill.bgClr = CreateAscColorEx(_fill.bgClr);
            break;
        }
        case FILL_TYPE_GRAD:
        {
            ret.type = c_oAscFill.FILL_TYPE_GRAD;
            ret.fill = new asc_CFillGrad();

            for (var i = 0; i < _fill.colors.length; i++)
            {
                if (0 == i)
                {
                    ret.fill.Colors = [];
                    ret.fill.Positions = [];
                }

                ret.fill.Colors.push(CreateAscColorEx(_fill.colors[i].color));
                ret.fill.Positions.push(_fill.colors[i].pos);
            }

            if (_fill.lin)
            {
                ret.fill.GradType = c_oAscFillGradType.GRAD_LINEAR;
                ret.fill.LinearAngle = _fill.lin.angle;
                ret.fill.LinearScale = _fill.lin.scale;
            }
            else
            {
                ret.fill.GradType = c_oAscFillGradType.GRAD_PATH;
                ret.fill.PathType = 0;
            }

            break;
        }
        case FILL_TYPE_BLIP:
        {
            ret.type = c_oAscFill.FILL_TYPE_BLIP;
            ret.fill = new asc_CFillBlip();

            ret.fill.url = _fill.RasterImageId;
            ret.fill.type = (_fill.tile == null) ? c_oAscFillBlipType.STRETCH : c_oAscFillBlipType.TILE;
            break;
        }
        default:
            break;
    }

    ret.transparent = unifill.transparent;
    return ret;
}

function CorrectUniFillEx(asc_fill, unifill) {

    if (null == asc_fill)
        return unifill;

    var ret = unifill;
    if (null == ret)
        ret = new CUniFill();

    var _fill = asc_fill.asc_getFill();
    var _type = asc_fill.asc_getType();

    if (null != _type)
    {
        switch (_type)
        {
            case c_oAscFill.FILL_TYPE_NOFILL:
            {
                ret.setFill(new CNoFill());
                break;
            }
            case c_oAscFill.FILL_TYPE_BLIP:
            {
                if (ret.fill == null || ret.fill.type != FILL_TYPE_BLIP)
                {
                    ret.setFill(new CBlipFill());
                }

                var _url = _fill.asc_getUrl();
                var _tx_id = _fill.asc_getTextureId();
                if (null != _tx_id && (0 <= _tx_id) && (_tx_id < g_oUserTexturePresets.length))
                {
                    _url = g_oUserTexturePresets[_tx_id];
                }

                if (_url != null && _url !== undefined && _url != "")
                    ret.fill.setRasterImageId(_url);

                if (ret.fill.RasterImageId == null)
                    ret.fill.setRasterImageId("");

                var tile = _fill.asc_getType();
                if (tile == c_oAscFillBlipType.STRETCH)
                    ret.fill.setTile(null);
                else if (tile == c_oAscFillBlipType.TILE)
                    ret.fill.setTile(true);

                break;
            }
            case c_oAscFill.FILL_TYPE_PATT:
            {
                if (ret.fill == null || ret.fill.type != FILL_TYPE_PATT)
                {
                    ret.setFill(new CPattFill());
                }

                if (undefined != _fill.PatternType)
                {
                    ret.fill.setFType(_fill.PatternType);
                }
                if (undefined != _fill.fgClr)
                {
                    ret.fill.setFgColor(CorrectUniColorEx(_fill.asc_getColorFg(), ret.fill.fgClr));
                }
                if (undefined != _fill.bgClr)
                {
                    ret.fill.setBgColor(CorrectUniColorEx(_fill.asc_getColorBg(), ret.fill.bgClr));
                }

                break;
            }
            case c_oAscFill.FILL_TYPE_GRAD:
            {
                if (ret.fill == null || ret.fill.type != FILL_TYPE_GRAD)
                {
                    ret.setFill(new CGradFill());
                }

                var _colors     = _fill.asc_getColors();
                var _positions  = _fill.asc_getPositions();
                if (undefined != _colors && undefined != _positions)
                {
                    if (_colors.length == _positions.length)
                    {
                        ret.fill.colors.splice(0, ret.fill.colors.length);

                        for (var i = 0; i < _colors.length; i++)
                        {
                            var _gs = new CGs();
                            _gs.setColor(CorrectUniColorEx(_colors[i], _gs.color));
                            _gs.setPos(_positions[i]);

                            ret.fill.addGS(_gs);
                        }
                    }
                }
                else if (undefined != _colors)
                {
                    if (_colors.length == ret.fill.colors.length)
                    {
                        for (var i = 0; i < _colors.length; i++)
                        {
                            if(!(_colors[i].value == null && _colors[i].type ===c_oAscColor.COLOR_TYPE_SCHEME))
                                ret.fill.colors[i].setColor(CorrectUniColorEx(_colors[i], ret.fill.colors[i].color));
                        }
                    }
                }
                else if (undefined != _positions)
                {
                    if (_positions.length == ret.fill.colors.length)
                    {
                        for (var i = 0; i < _positions.length; i++)
                        {
                            ret.fill.colors[i].setPos(_positions[i]);
                        }
                    }
                }

                var _grad_type = _fill.asc_getGradType();

                if (c_oAscFillGradType.GRAD_LINEAR == _grad_type)
                {
                    var _angle = _fill.asc_getLinearAngle();
                    var _scale = _fill.asc_getLinearScale();

                    if (!ret.fill.lin)
                        ret.fill.setLin(new GradLin());

                    if (undefined != _angle)
                        ret.fill.lin.setAngle(_angle);
                    if (undefined != _scale)
                        ret.fill.lin.setScale(_scale);
                }
                else if (c_oAscFillGradType.GRAD_PATH == _grad_type)
                {
                    ret.fill.setLin(null);
                    ret.fill.setPath(new GradPath());
                }
                break;
            }
            default:
            {
                if (ret.fill == null || ret.fill.type != FILL_TYPE_SOLID)
                {
                    ret.setFill(new CSolidFill());
                }
                ret.fill.setColor(CorrectUniColorEx(_fill.asc_getColor(), ret.fill.color));
            }
        }
    }

    var _alpha = asc_fill.asc_getTransparent();
    if (null != _alpha)
        ret.setTransparent(_alpha);

    return ret;
}

function asc_CStroke() {
    this.type = null;
    this.width = null;
    this.color = null;

    this.LineJoin = null;
    this.LineCap = null;

    this.LineBeginStyle = null;
    this.LineBeginSize = null;

    this.LineEndStyle = null;
    this.LineEndSize = null;

    this.canChangeArrows = false;
}

asc_CStroke.prototype = {
    asc_getType: function(){return this.type;},
    asc_putType: function(v){this.type = v;},
    asc_getWidth: function(){return this.width;},
    asc_putWidth: function(v){this.width = v;},
    asc_getColor: function(){return this.color;},
    asc_putColor: function(v){this.color = v;},

    asc_getLinejoin: function(){return this.LineJoin;},
    asc_putLinejoin: function(v){this.LineJoin = v;},
    asc_getLinecap: function(){return this.LineCap;},
    asc_putLinecap: function(v){this.LineCap = v;},

    asc_getLinebeginstyle: function(){return this.LineBeginStyle;},
    asc_putLinebeginstyle: function(v){this.LineBeginStyle = v;},
    asc_getLinebeginsize: function(){return this.LineBeginSize;},
    asc_putLinebeginsize: function(v){this.LineBeginSize = v;},
    asc_getLineendstyle: function(){return this.LineEndStyle;},
    asc_putLineendstyle: function(v){this.LineEndStyle = v;},
    asc_getLineendsize: function(){return this.LineEndSize;},
    asc_putLineendsize: function(v){this.LineEndSize = v;},

    asc_getCanChangeArrows: function(){return this.canChangeArrows;}
}

//{ asc_CStroke export
window["Asc"].asc_CStroke = asc_CStroke;
window["Asc"]["asc_CStroke"] = asc_CStroke;
prot = asc_CStroke.prototype;

prot["asc_getType"] = prot.asc_getType;
prot["asc_putType"] = prot.asc_putType;
prot["asc_getWidth"] = prot.asc_getWidth;
prot["asc_putWidth"] = prot.asc_putWidth;
prot["asc_getColor"] = prot.asc_getColor;
prot["asc_putColor"] = prot.asc_putColor;

prot["asc_getLinejoin"] = prot.asc_getLinejoin;
prot["asc_putLinejoin"] = prot.asc_putLinejoin;
prot["asc_getLinecap"] = prot.asc_getLinecap;
prot["asc_putLinecap"] = prot.asc_putLinecap;

prot["asc_getLinebeginstyle"] = prot.asc_getLinebeginstyle;
prot["asc_putLinebeginstyle"] = prot.asc_putLinebeginstyle;
prot["asc_getLinebeginsize"] = prot.asc_getLinebeginsize;
prot["asc_putLinebeginsize"] = prot.asc_putLinebeginsize;
prot["asc_getLineendstyle"] = prot.asc_getLineendstyle;
prot["asc_putLineendstyle"] = prot.asc_putLineendstyle;
prot["asc_getLineendsize"] = prot.asc_getLineendsize;
prot["asc_putLineendsize"] = prot.asc_putLineendsize;

prot["asc_getCanChangeArrows"] = prot.asc_getCanChangeArrows;
//}

function CreateAscStrokeEx(ln, _canChangeArrows) {
    if (null == ln || null == ln.Fill || ln.Fill.fill == null)
        return new asc_CStroke();

    var ret = new asc_CStroke();

    var _fill = ln.Fill.fill;
    if(_fill != null)
    {
        switch (_fill.type)
        {
            case FILL_TYPE_BLIP:
            {
                break;
            }
            case FILL_TYPE_SOLID:
            {
                ret.color = CreateAscColorEx(_fill.color);
                ret.type = c_oAscStrokeType.STROKE_COLOR;
                break;
            }
            case FILL_TYPE_GRAD:
            {
                var _c = _fill.colors;
                if (_c != 0)
                {
                    ret.color = CreateAscColorEx(_fill.colors[0]);
                    ret.type = c_oAscStrokeType.STROKE_COLOR;
                }

                break;
            }
            case FILL_TYPE_PATT:
            {
                ret.color = CreateAscColorEx(_fill.fgClr);
                ret.type = c_oAscStrokeType.STROKE_COLOR;
                break;
            }
            case FILL_TYPE_NOFILL:
            {
                ret.color = null;
                ret.type = c_oAscStrokeType.STROKE_NONE;
                break;
            }
            default:
            {
                break;
            }
        }
    }


    ret.width = (ln.w == null) ? 12700 : (ln.w >> 0);
    ret.width /= 36000.0;

    if (ln.cap != null)
        ret.asc_putLinecap(ln.cap);

    if (ln.LineJoin != null)
        ret.asc_putLinejoin(ln.LineJoin.type);

    if (ln.headEnd != null)
    {
        ret.asc_putLinebeginstyle((ln.headEnd.type == null) ? LineEndType.None : ln.headEnd.type);

        var _len = (null == ln.headEnd.len) ? 1 : (2 - ln.headEnd.len);
        var _w = (null == ln.headEnd.w) ? 1 : (2 - ln.headEnd.w);

        ret.asc_putLinebeginsize(_w * 3 + _len);
    }
    else
    {
        ret.asc_putLinebeginstyle(LineEndType.None);
    }

    if (ln.tailEnd != null)
    {
        ret.asc_putLineendstyle((ln.tailEnd.type == null) ? LineEndType.None : ln.tailEnd.type);

        var _len = (null == ln.tailEnd.len) ? 1 : (2 - ln.tailEnd.len);
        var _w = (null == ln.tailEnd.w) ? 1 : (2 - ln.tailEnd.w);

        ret.asc_putLineendsize(_w * 3 + _len);
    }
    else
    {
        ret.asc_putLineendstyle(LineEndType.None);
    }

    if (true === _canChangeArrows)
        ret.canChangeArrows = true;

    return ret;
}

function CorrectUniStrokeEx(asc_stroke, unistroke) {
    if (null == asc_stroke)
        return unistroke;

    var ret = unistroke;
    if (null == ret)
        ret = new CLn();

    var _type = asc_stroke.asc_getType();
    var _w = asc_stroke.asc_getWidth();

    if (_w != null && _w !== undefined)
        ret.setW(_w * 36000.0);

    var _color = asc_stroke.asc_getColor();
    if (_type == c_oAscStrokeType.STROKE_NONE)
    {
        ret.setFill(new CUniFill());
        ret.Fill.setFill(new CNoFill());
    }
    else if (_type != null)
    {
        if (null != _color && undefined !== _color)
        {
            ret.setFill(new CUniFill());
            ret.Fill.setFill(new CSolidFill());
            ret.Fill.fill.setColor(CorrectUniColorEx(_color, ret.Fill.fill.color));
        }
    }

    var _join = asc_stroke.asc_getLinejoin();
    if (null != _join)
    {
        ret.LineJoin = new LineJoin();
        ret.LineJoin.type = _join;
    }

    var _cap = asc_stroke.asc_getLinecap();
    if (null != _cap)
    {
        ret.cap = _cap;
    }

    var _begin_style = asc_stroke.asc_getLinebeginstyle();
    if (null != _begin_style)
    {
        if (ret.headEnd == null)
            ret.headEnd = new EndArrow();

        ret.headEnd.type = _begin_style;
    }

    var _end_style = asc_stroke.asc_getLineendstyle();
    if (null != _end_style)
    {
        if (ret.tailEnd == null)
            ret.tailEnd = new EndArrow();

        ret.tailEnd.type = _end_style;
    }

    var _begin_size = asc_stroke.asc_getLinebeginsize();
    if (null != _begin_size)
    {
        if (ret.headEnd == null)
            ret.headEnd = new EndArrow();

        ret.headEnd.w = 2 - ((_begin_size/3) >> 0);
        ret.headEnd.len = 2 - (_begin_size % 3);
    }

    var _end_size = asc_stroke.asc_getLineendsize();
    if (null != _end_size)
    {
        if (ret.tailEnd == null)
            ret.tailEnd = new EndArrow();

        ret.tailEnd.w = 2 - ((_end_size/3) >> 0);
        ret.tailEnd.len = 2 - (_end_size % 3);
    }

    return ret;
}


function DeleteSelectedObjects(controller)
{
    var selected_objects = controller.selectedObjects;
    for(var i = selected_objects.length - 1; i > -1; --i)
    {
        selected_objects[i].deleteDrawingBase();
    }
    controller.resetSelection();
}


function CreateImageDrawingObject(imageUrl, options, drawingObjects) {

    var _this = drawingObjects;
    var  worksheet = drawingObjects.getWorksheet();
    if ( imageUrl && !_this.isViewerMode() ) {

        var _image =  asc["editor"].ImageLoader.LoadImage(imageUrl, 1);
        var isOption = options && options.cell;

        var calculateObjectMetrics = function (object, width, height) {
            // Обработка картинок большого разрешения
            var metricCoeff = 1;

            var coordsFrom = _this.coordsManager.calculateCoords(object.from);
            var realTopOffset = coordsFrom.y;
            var realLeftOffset = coordsFrom.x;

            var areaWidth = worksheet.getCellLeft(worksheet.getLastVisibleCol(), 0) - worksheet.getCellLeft(worksheet.getFirstVisibleCol(), 0); 	// по ширине
            if (areaWidth < width) {
                metricCoeff = width / areaWidth;

                width = areaWidth;
                height /= metricCoeff;
            }

            var areaHeight = worksheet.getCellTop(worksheet.getLastVisibleRow(), 0) - worksheet.getCellTop(worksheet.getFirstVisibleRow(), 0); 	// по высоте
            if (areaHeight < height) {
                metricCoeff = height / areaHeight;

                height = areaHeight;
                width /= metricCoeff;
            }

            var cellTo = _this.coordsManager.calculateCell(realLeftOffset + width, realTopOffset + height);
            object.to.col = cellTo.col;
            object.to.colOff = cellTo.colOff;
            object.to.row = cellTo.row;
            object.to.rowOff = cellTo.rowOff;

            worksheet.handlers.trigger("reinitializeScroll");
        }

        var addImageObject = function (_image) {

            if ( !_image.Image ) {
                worksheet.model.workbook.handlers.trigger("asc_onError", c_oAscError.ID.UplImageUrl, c_oAscError.Level.NoCritical);
            }
            else {

                var drawingObject = _this.createDrawingObject();
                drawingObject.worksheet = worksheet;

                drawingObject.from.col = isOption ? options.cell.col : worksheet.getSelectedColumnIndex();
                drawingObject.from.row = isOption ? options.cell.row : worksheet.getSelectedRowIndex();

                // Проверяем начальные координаты при вставке
                while ( !worksheet.cols[drawingObject.from.col] ) {
                    worksheet.expandColsOnScroll(true);
                }
                worksheet.expandColsOnScroll(true); 	// для colOff

                while ( !worksheet.rows[drawingObject.from.row] ) {
                    worksheet.expandRowsOnScroll(true);
                }
                worksheet.expandRowsOnScroll(true); 	// для rowOff

                calculateObjectMetrics(drawingObject, isOption ? options.width : _image.Image.width, isOption ? options.height : _image.Image.height);

                var coordsFrom = _this.coordsManager.calculateCoords(drawingObject.from);
                var coordsTo = _this.coordsManager.calculateCoords(drawingObject.to);
                drawingObject.graphicObject = new CImageShape(drawingObject, _this);
                drawingObject.graphicObject.initDefault( drawingObjects.convertMetric(coordsFrom.x, 0, 3), drawingObjects.convertMetric(coordsFrom.y, 0, 3), drawingObjects.convertMetric(coordsTo.x - coordsFrom.x, 0, 3), drawingObjects.convertMetric(coordsTo.y - coordsFrom.y, 0, 3), _image.src );
                // drawingObject.graphicObject.select(_this.controller);
                drawingObject.graphicObject.setDrawingObjects(_this);
                //drawingObject.graphicObject.addToDrawingObjects();
                return drawingObject;
            }
        }
        if (null != _image)
        {
            return addImageObject(_image);
        }
    }
    return null;
}