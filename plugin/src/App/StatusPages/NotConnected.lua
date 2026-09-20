local Rojo = script:FindFirstAncestor("Rojo")
local Plugin = Rojo.Plugin
local Packages = Rojo.Packages

local Roact = require(Packages.Roact)

local TextButton = require(Plugin.App.Components.TextButton)
local Header = require(Plugin.App.Components.Header)
local Tooltip = require(Plugin.App.Components.Tooltip)

local e = Roact.createElement

local function ProjectPicker(props)
	local projects = props.projects or {}
	local rows = {}

	for index, project in ipairs(projects) do
		local state = project.state or "unknown"
		local enabled = state == "running"
		local folderName = if project.folderPath
			then string.match(project.folderPath, "[^/\\]+$") or project.folderPath
			else nil
		local label = if folderName
			then string.format("%s / %s", folderName, project.name or project.id)
			else project.name or project.id
		rows[project.id or tostring(index)] = e("TextButton", {
			Text = label .. (enabled and "    Connect" or "  [not running]"),
			Font = Enum.Font.SourceSans,
			TextSize = 15,
			TextXAlignment = Enum.TextXAlignment.Left,
			TextColor3 = enabled and Color3.fromRGB(235, 235, 235) or Color3.fromRGB(145, 145, 145),
			BackgroundColor3 = Color3.fromRGB(45, 48, 54),
			BackgroundTransparency = props.transparency,
			BorderSizePixel = 0,
			AutoButtonColor = enabled,
			Active = enabled,
			Size = UDim2.new(1, -4, 0, 30),
			LayoutOrder = index,

			[Roact.Event.Activated] = if enabled
				then function()
					props.onSelect(project)
				end
				else nil,
		}, {
			Padding = e("UIPadding", {
				PaddingLeft = UDim.new(0, 9),
			}),
			Corner = e("UICorner", {
				CornerRadius = UDim.new(0, 4),
			}),
		})
	end

	rows.Layout = e("UIListLayout", {
		SortOrder = Enum.SortOrder.LayoutOrder,
		Padding = UDim.new(0, 4),
	})

	return e("Frame", {
		Size = UDim2.new(1, 0, 0, 206),
		LayoutOrder = props.layoutOrder,
		BackgroundTransparency = 1,
	}, {
		Title = e("TextLabel", {
			Text = "MANAGED ROJO PROJECTS",
			Font = Enum.Font.SourceSansBold,
			TextSize = 13,
			TextColor3 = Color3.fromRGB(170, 174, 182),
			TextXAlignment = Enum.TextXAlignment.Left,
			BackgroundTransparency = 1,
			Size = UDim2.new(1, -70, 0, 22),
		}),
		Refresh = e("TextButton", {
			Text = "Refresh",
			Font = Enum.Font.SourceSans,
			TextSize = 14,
			TextColor3 = Color3.fromRGB(85, 170, 255),
			BackgroundTransparency = 1,
			Size = UDim2.new(0, 62, 0, 22),
			Position = UDim2.new(1, -62, 0, 0),
			[Roact.Event.Activated] = props.onRefresh,
		}),
		Status = e("TextLabel", {
			Text = props.status or "",
			Font = Enum.Font.SourceSans,
			TextSize = 13,
			TextColor3 = Color3.fromRGB(145, 149, 158),
			TextXAlignment = Enum.TextXAlignment.Left,
			TextTruncate = Enum.TextTruncate.AtEnd,
			BackgroundTransparency = 1,
			Size = UDim2.new(1, 0, 0, 20),
			Position = UDim2.new(0, 0, 0, 22),
		}),
		List = e("ScrollingFrame", {
			CanvasSize = UDim2.new(0, 0, 0, math.max(0, (#projects * 34) - 4)),
			ScrollBarThickness = 4,
			BackgroundTransparency = 1,
			BorderSizePixel = 0,
			Size = UDim2.new(1, 0, 0, 160),
			Position = UDim2.new(0, 0, 0, 46),
		}, rows),
	})
end

local NotConnectedPage = Roact.Component:extend("NotConnectedPage")

function NotConnectedPage:render()
	return Roact.createFragment({
		Header = e(Header, {
			transparency = self.props.transparency,
			layoutOrder = 1,
		}),

		ProjectPicker = e(ProjectPicker, {
			projects = self.props.managedProjects,
			status = self.props.managerStatus,
			onRefresh = self.props.onRefreshProjects,
			onSelect = self.props.onSelectProject,
			transparency = self.props.transparency,
			layoutOrder = 2,
		}),

		Buttons = e("Frame", {
			Size = UDim2.new(1, 0, 0, 34),
			LayoutOrder = 3,
			BackgroundTransparency = 1,
			ZIndex = 2,
		}, {
			Settings = e(TextButton, {
				text = "Settings",
				style = "Bordered",
				transparency = self.props.transparency,
				layoutOrder = 1,
				onClick = self.props.onNavigateSettings,
			}, {
				Tip = e(Tooltip.Trigger, {
					text = "View and modify plugin settings",
				}),
			}),

			Layout = e("UIListLayout", {
				HorizontalAlignment = Enum.HorizontalAlignment.Right,
				FillDirection = Enum.FillDirection.Horizontal,
				SortOrder = Enum.SortOrder.LayoutOrder,
				Padding = UDim.new(0, 10),
			}),
		}),

		Layout = e("UIListLayout", {
			HorizontalAlignment = Enum.HorizontalAlignment.Center,
			VerticalAlignment = Enum.VerticalAlignment.Center,
			FillDirection = Enum.FillDirection.Vertical,
			SortOrder = Enum.SortOrder.LayoutOrder,
			Padding = UDim.new(0, 10),
		}),

		Padding = e("UIPadding", {
			PaddingLeft = UDim.new(0, 20),
			PaddingRight = UDim.new(0, 20),
		}),
	})
end

return NotConnectedPage
